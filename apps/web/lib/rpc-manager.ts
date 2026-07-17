import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  AuthStorage,
  SessionManager,
  SettingsManager,
  Theme,
  type AgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import { createHash, randomUUID } from "crypto";
import { cacheSessionPath } from "./session-reader";
import { decrementUserSessionCap } from "./session-cap";
import { resolveAgentMcpServers, resolveAgentSkills } from "./scope-resolve";
import { prisma } from "./prisma";
import { decryptSecret } from "./secret-crypto";
import type { SlashCommandInfo, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "./pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

// ============================================================================
// Scope hashing
//
// A "scope" identifies the set of skills + MCP servers an agent is bound to.
// Two sessions with the same scope share the same services cache; sessions
// with different scopes must NOT share a cache entry (otherwise agent-bound
// skills/MCP bleed across agents that happen to share a cwd).
//
// The hash is order-independent (sorted before hashing) so that
// { skills: ["a","b"] } and { skills: ["b","a"] } collide.
// ============================================================================

export interface ScopeSet {
  skills: string[];
  mcpServers: string[];
}

export function computeScopeHash(scope: ScopeSet): string {
  const norm = JSON.stringify({
    skills: [...scope.skills].sort(),
    mcpServers: [...scope.mcpServers].sort(),
  });
  return createHash("sha256").update(norm).digest("hex");
}

// ----------------------------------------------------------------------------
// Agent scope injection
//
// The four-layer resolvers (resolveAgentSkills / resolveAgentMcpServers)
// return resolved id arrays. To actually inject those into a pi session we
// need to map them to the SDK's DefaultResourceLoaderOptions shape:
//   - skills -> additionalSkillPaths (each slug resolved to a path)
//   - mcpServers -> additionalExtensionPaths (each id resolved to an extension path)
// When the resolved set is empty we set `noSkills: true` and skip extensions
// entirely; we never disable extensions because the SDK has its own baseline
// extension set that must remain loadable.
//
// Path resolution is intentionally best-effort: we map `<id-or-slug>` to
// `<cwd>/.pi/<kind>/<id-or-slug>` so the SDK's resource loader can pick it
// up if the user actually has that artifact on disk. Missing paths are
// silently ignored by the SDK; the override layers (`skillsOverride` /
// `extensionsOverride`) are not used here — Task 2.5 / 3.x may layer them
// on top later.
// ----------------------------------------------------------------------------

export interface AgentScopeMcpRef {
  id: string;
  name: string;
  transport: string;
}

export interface AgentScopeInput {
  skills: string[];
  mcpServers: AgentScopeMcpRef[];
}

/**
 * Caller-side input for `startRpcSession`. Identifies the agent whose
 * four-layer scope should be resolved at session-start time. Passed as
 * the last positional argument so existing callers (no scope resolution)
 * keep compiling without source changes.
 */
export interface AgentScopeResolveInput {
  agentId: string;
  userId: string;
  teamId: string | null;
  scope?: "team" | "personal";
}

/**
 * Build the `DefaultResourceLoaderOptions` payload from a resolved
 * four-layer scope. Returned object is passed as `resourceLoaderOptions`
 * to `createAgentSessionServices`.
 *
 * Contract:
 * - `noSkills === true` iff `skills.length === 0`
 * - `additionalSkillPaths` length equals `skills.length` (one entry per slug)
 * - `additionalExtensionPaths` length equals `mcpServers.length` (one entry per id)
 * - Caller computes `scopeHash` separately via `computeScopeHash` over the
 *   same id arrays and passes it as the services cache key.
 */
export function buildResourceLoaderOptions(
  scope: AgentScopeInput,
): {
  noSkills: boolean;
  additionalSkillPaths: string[];
  additionalExtensionPaths: string[];
} {
  return {
    noSkills: scope.skills.length === 0,
    additionalSkillPaths: scope.skills.map((slug) => `.pi/skills/${slug}`),
    additionalExtensionPaths: scope.mcpServers.map((m) => `.pi/extensions/${m.id}`),
  };
}

// Extensions require a complete Theme, while the web UI applies its own styling.
class PlainTextTheme extends Theme {
  constructor() {
    super(
      { thinkingXhigh: "" } as ConstructorParameters<typeof Theme>[0],
      {} as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
  override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
  override bold(text: string): string { return text; }
  override italic(text: string): string { return text; }
  override underline(text: string): string { return text; }
  override inverse(text: string): string { return text; }
  override strikethrough(text: string): string { return text; }
  override getFgAnsi(): string { return ""; }
  override getBgAnsi(): string { return ""; }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string { return (text) => text; }
}

const PLAIN_TEXT_THEME = new PlainTextTheme();

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private promptRunning = false;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private _alive = true;
  // Owning userId, set at construction. Used by destroyAllSessionsForUser
  // so the LRU eviction in lib/session-cap can match sessions to their
  // owner without needing a separate userId->sessionIds map. Defaults
  // to null for legacy callers and is overridden via the second
  // constructor argument.
  private _userId: string | null;

  constructor(public readonly inner: AgentSessionLike, userId: string | null = null) {
    this._userId = userId;
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  /**
   * Returns true when this wrapper's owning userId matches `userId`.
   * Sessions created without an owner (legacy callers) match any
   * userId, so LRU eviction of an unrelated user is still safe — the
   * cap counter is the authoritative source of truth.
   */
  _isOwnedBy(userId: string): boolean {
    return this._userId === null || this._userId === userId;
  }

  get userId(): string | null {
    return this._userId;
  }

  isRunning(): boolean {
    return this._alive && (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting);
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      this.emit(event);
      // Streaming / compaction / tool events flow through here; re-broadcast
      // the running-status snapshot so the sidebar can update live.
      notifyRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      console.error("[pi-web] failed to dispatch session_start to extensions:", err instanceof Error ? err.message : err);
    });
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in pi-web.",
          } as ExtensionUiRequest as AgentEvent),
          onError: (error) => this.emit({
            type: "extension_error",
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.applyForcedEmptySystemPrompt();
      console.log(`[pi-web] session_start dispatched to extensions for session ${this.inner.sessionId}`);
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      notifyRunningChange();
    }
  }

  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.destroy(), 10 * 60 * 1000);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  /**
   * Public emit — allows external callers (e.g. the delegate-agent-tool) to
   * broadcast events into this session's SSE listener chain without subscribing.
   * Used by T3.7 to forward child-agent progress events to the root SSE.
   */
  emit(event: AgentEvent): void {
    for (const l of this.listeners) l(event);
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();

    switch (type) {
      case "prompt": {
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        this.promptRunning = true;
        notifyRunningChange();
        this.inner.prompt(command.message as string, {
          ...(promptImages?.length ? { images: promptImages } : {}),
          ...(streamingBehavior ? { streamingBehavior } : {}),
          source: "rpc",
        }).then(() => {
          this.promptRunning = false;
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
          notifyRunningChange();
        }).catch((error) => {
          this.promptRunning = false;
          this.emit({
            type: "prompt_error",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
          notifyRunningChange();
        });
        return null;
      }

      case "abort":
        await this.withFinalRunningNotification(() => this.inner.abort());
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const registry = this.inner.modelRegistry;
        const model = registry.find(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        this.destroy();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        return null;
      }

      case "compact": {
        const result = await this.withFinalRunningNotification(() =>
          this.inner.compact(command.customInstructions as string | undefined)
        );
        return result;
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        const toolNames = command.toolNames as string[];
        this.setForceEmptySystemPrompt(toolNames.length === 0);
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
        this.applyForcedEmptySystemPrompt();
        return null;
      }

      case "reload": {
        await this.waitForExtensionsBound();
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload();
        if (typeof this.inner.bindExtensions !== "function") {
          this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
        }
        this.applyForcedEmptySystemPrompt();
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribe?.();
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.onDestroyCallback?.();
    notifyRunningChange();
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return 92;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return 92;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    } as ExtensionUiRequest as AgentEvent;
    this.pendingUiRequests.set(id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as AgentEvent);
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(
    factory: unknown,
    options?: unknown,
  ): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      const tui = {
        requestRender: () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
      };
      const done = (value: T) => this.closeCustomUi(id, value);

      Promise.resolve()
        .then(() => factory(tui, undefined, undefined, done))
        .then((component) => {
          if (!component || typeof component !== "object" || typeof (component as CustomUiComponent).render !== "function") {
            resolve(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => resolve(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          resolve(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.extensionWidgets.delete(key);
        } else {
          this.extensionWidgets.set(key, {
            key,
            lines: content,
            placement: options?.placement ?? "aboveEditor",
          });
        }
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        } as ExtensionUiRequest as AgentEvent);
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() { return PLAIN_TEXT_THEME; },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in pi-web extension UI yet" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
        this.applyForcedEmptySystemPrompt();
      },
    };
  }
}

// ============================================================================
// Per-cwd services cache
//
// createAgentSessionServices() builds AuthStorage, ModelRegistry,
// SettingsManager, and DefaultResourceLoader — the latter scans the
// filesystem and loads ALL extensions, skills, prompts, and themes.
// Each fresh build costs ~250MB and the SDK never frees it, so under
// sustained session churn the dev server OOMs within minutes
// (reproduced 2026-07-14: 5 sessions = +1.7GB, and even after destroy
// the RSS did not drop).
//
// The services are read-only after creation (modelRegistry.find,
// resourceLoader.getExtensions, settingsManager.getXxx are all getters),
// so they are safe to share across sessions that target the same cwd.
// We key the cache on `cwd` because all of the loaded resources are
// cwd-bound (settings, extensions discovered under cwd). agentDir is
// process-global (getAgentDir), so it's implicitly constant.
// ============================================================================
declare global {
  // eslint-disable-next-line no-var
  var __piServicesCache: Map<string, Promise<AgentSessionServices>> | undefined;
}

function getServicesCache(): Map<string, Promise<AgentSessionServices>> {
  if (!globalThis.__piServicesCache) {
    globalThis.__piServicesCache = new Map();
  }
  return globalThis.__piServicesCache;
}
type AgentServices = AgentSessionServices;

// ----------------------------------------------------------------------------
// Per-tenant AuthStorage + SettingsManager (Task 2.6)
//
// Every spawn gets its own InMemory AuthStorage + InMemory SettingsManager.
// AuthStorage is populated from the calling user's `UserApiKey` rows (BYOK)
// decrypted with AES-256-GCM. SettingsManager is empty for now — per-request
// settings (e.g. default model) come from session-start overrides in the UI
// layer, not from disk.
//
// Backward compatibility: when `userId === null` (legacy callers, e.g. tests
// and SSE reconnect paths that don't have a request context yet), both
// helpers fall back to empty InMemory instances. Sessions for users without
// any BYOK keys still start — the SDK's `getApiKey()` chain will fall
// through to env vars / OAuth / platform keys, matching the documented
// resolution priority.
// ----------------------------------------------------------------------------

/**
 * Load the calling user's BYOK API keys from the database and decrypt them.
 *
 * Decryption is delegated to the canonical `decryptSecret` helper in
 * `lib/secret-crypto.ts` (T7.1), so `UserApiKey.secretEnc` uses exactly the
 * same `<iv>:<authTag>:<ciphertext>` envelope as every other at-rest secret.
 *
 * Returns an empty array when `userId === null` so legacy callers (no auth
 * context) still work — the resulting InMemory AuthStorage will simply have
 * no per-user credentials and the SDK's resolution chain falls through to
 * env vars / OAuth / platform keys.
 *
 * Decryption failures are surfaced as a thrown error so the spawn fails
 * fast; we never silently substitute a placeholder or fall back to a
 * leaked ciphertext-as-key.
 */
export async function loadUserApiKeys(
  userId: string | null,
): Promise<Array<{ provider: string; apiKey: string }>> {
  if (!userId) return [];
  const rows = await prisma.userApiKey.findMany({
    where: { userId },
    select: { provider: true, secretEnc: true },
  });
  return rows.map((row) => ({
    provider: row.provider,
    apiKey: decryptSecret(row.secretEnc),
  }));
}

/**
 * Build a per-request InMemory AuthStorage pre-populated with the calling
 * user's BYOK keys. When the user has no BYOK, the storage is still valid
 * (just empty) so the SDK's `getApiKey()` resolution chain continues to
 * env vars / OAuth / platform keys.
 */
export async function buildInMemoryAuthStorage(
  userApiKeys: Array<{ provider: string; apiKey: string }>,
): Promise<AuthStorage> {
  // Dynamic import keeps `AuthStorage` out of the module-graph until we
  // actually need it; also gives us a single import point to swap with
  // the real static import on first call.
  const data = Object.fromEntries(
    userApiKeys.map((k) => [k.provider, { type: "api_key" as const, key: k.apiKey }]),
  );
  return AuthStorage.inMemory(data);
}

/**
 * Build a per-request InMemory SettingsManager. Empty by design — per-user
 * preferences (default model, theme, etc.) live in the dedicated settings
 * UI (T6.8) and will be passed as `applyOverrides` once that lands. For
 * now the SDK's defaults are correct.
 */
export async function buildInMemorySettingsManager(): Promise<SettingsManager> {
  return SettingsManager.inMemory();
}

/**
 * Bootstrap both per-tenant services in one go. Used by
 * `getOrCreateServices` so the cache key can include `userId` and the
 * BYOK fetch + AuthStorage/SettingsManager construction only happens once
 * per (cwd, scope, userId) tuple.
 */
async function bootstrapTenantServices(
  userId: string | null,
): Promise<{ authStorage: AuthStorage; settingsManager: SettingsManager }> {
  const [userApiKeys, settingsManager] = await Promise.all([
    loadUserApiKeys(userId),
    buildInMemorySettingsManager(),
  ]);
  const authStorage = await buildInMemoryAuthStorage(userApiKeys);
  return { authStorage, settingsManager };
}

function getOrCreateServices(
  cwd: string,
  scopeHash: string,
  agentDir: string,
  scope: AgentScopeInput,
  userId: string | null
): Promise<AgentServices> {
  const cache = getServicesCache();
  // Task 2.6: include the userId in the cache key so two users with the
  // same cwd + same skill/MCP scope still get distinct AuthStorage /
  // SettingsManager instances (BYOK keys are user-scoped and MUST NOT
  // leak across sessions). userId === null falls back to the legacy
  // shared-services path (legacy callers with no auth context).
  const cacheKey = `${cwd}::${scopeHash}::${userId ?? "_legacy"}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;
  // Task 2.4: fold the resolved skill/MCP scope into the resource loader so
  // each per-scope cache entry actually loads the right set of skills and
  // MCP extensions. The `resourceLoaderOptions` payload is built once per
  // cache miss (the cache key includes scopeHash so different scopes never
  // share an entry, so we never rebuild for the same scope).
  const resourceLoaderOptions = buildResourceLoaderOptions(scope);
  // Task 2.6: per-tenant BYOK AuthStorage + per-request SettingsManager.
  // Both are InMemory — they never touch disk (no global auth.json, no
  // project settings.json), and they are scoped to this single spawn so
  // one user's BYOK keys can never bleed into another user's session.
  const tenantBootstrap = bootstrapTenantServices(userId);
  const fresh: Promise<AgentServices> = tenantBootstrap.then(({ authStorage, settingsManager }) =>
    createAgentSessionServices({
      cwd,
      agentDir,
      authStorage,
      settingsManager,
      resourceLoaderOptions,
    })
  );
  cache.set(cacheKey, fresh);
  // If the first build throws, drop the cached rejection so the next
  // caller can retry instead of propagating a stale failure forever.
  fresh.catch(() => cache.delete(cacheKey));
  return fresh;
}

// ----------------------------------------------------------------------------
// Session registry
// ----------------------------------------------------------------------------

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  var __piRunningListeners: Set<(ids: string[]) => void> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

/**
 * Destroy every live session owned by `userId` and return the number
 * destroyed. This is the LRU-eviction primitive used by
 * `lib/session-cap.ts` when a per-user or global cap is hit. We don't
 * require the caller to know the session IDs — we walk the registry.
 *
 * Side effects, in order:
 *  1. For each matching session: `wrapper.destroy()` (idempotent).
 *     `destroy` fires `onDestroy` which `registry.delete(realSessionId)`,
 *     so the registry is self-cleaning.
 *  2. For each destroyed session: `decrementUserSessionCap(userId)` is
 *     called by the SSE route's cleanup handler when the SSE is the one
 *     that closed it. For an LRU eviction triggered by the cap check
 *     (no SSE close), we ALSO decrement here so the cap counter stays
 *     consistent. (See note below about double-decrement safety.)
 *
 * Double-decrement safety: the SSE cleanup handler is wired to the
 * `abort` signal on the SSE request. When we destroy here, the SSE
 * controller will eventually error and trigger the abort handler, which
 * will ALSO call `decrementUserSessionCap`. To avoid that, the SSE
 * route checks `if (destroyed) return;` (set via the wrapper's `_alive`
 * flag) before decrementing.
 */
export function destroyAllSessionsForUser(userId: string): number {
  const registry = getRegistry();
  let destroyed = 0;
  for (const [sessionId, wrapper] of registry) {
    if (wrapper._isOwnedBy(userId) && wrapper.isAlive()) {
      try {
        wrapper.destroy();
        destroyed++;
        // Cap counter decrement is the responsibility of the route that
        // initiated the destroy. For LRU eviction there is no closing
        // route, so we decrement here. The SSE route guards against
        // double-decrement via wrapper._alive (false after destroy).
        // We use a direct import to avoid the circular-dep path that
        // session-cap would otherwise walk back through us.
        decrementUserSessionCap(userId);
      } catch {
        // best-effort; the next LRU sweep will retry
      }
    }
  }
  // sessionId unused but keep iteration explicit
  void Array.from(registry.keys());
  return destroyed;
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

// ----------------------------------------------------------------------------
// Running-status broadcaster
//
// Pushes the current set of running session ids to subscribers whenever any
// session's running state may have changed. This lets the sidebar receive live
// updates over SSE instead of polling. Listeners live on globalThis so they
// survive Next.js hot-reload.
// ----------------------------------------------------------------------------

function getRunningListeners(): Set<(ids: string[]) => void> {
  if (!globalThis.__piRunningListeners) globalThis.__piRunningListeners = new Set();
  return globalThis.__piRunningListeners;
}

/** Subscribe to running-session-id changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let lastRunningSnapshot = "";

/**
 * Recompute the running-session-id set and, if it changed since the last
 * notification, broadcast it to subscribers. Cheap to call often.
 */
export function notifyRunningChange(): void {
  const ids = getRunningRpcSessionIds();
  const snapshot = JSON.stringify([...ids].sort());
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of getRunningListeners()) {
    try { listener(ids); } catch { /* ignore listener errors */ }
  }
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 *
 * Pass `agentScope` to wire the four-layer skill/MCP resolver into the session:
 * when provided, `startRpcSession` calls `resolveAgentSkills` + `resolveAgentMcpServers`,
 * folds them into a `scopeHash` (used as the per-cwd services cache key so that
 * two agents with different scopes never share a cache entry), and injects the
 * resolved ids as `resourceLoaderOptions` on `createAgentSessionServices`. When
 * omitted, the session falls back to the legacy behavior (`scopeHash = ""`,
 * no resource loader overrides).
 *
 * Pass `customTools` to register additional `ToolDefinition`s on the session
 * via `createAgentSessionFromServices.customTools`. These are additive: they
 * layer on top of any tools the resource loader registers. When omitted, no
 * extra custom tools are added (legacy behavior).
 *
 * Pass `excludeTools` to remove tool names from the session's available set
 * via `createAgentSessionFromServices.excludeTools`. When omitted, no tools
 * are excluded (legacy behavior).
 *
 * ---
 * T3.5 — per-user session cap exemption for delegation children:
 *
 * Sessions created as delegation children (i.e., `startRpcSession` is called from
 * `runSingleChild` / `runAsyncChild` in `delegate-agent-tool.ts`) have
 * `agentScope.rootSessionId` set to the root Supervisor's sessionId. These sessions
 * are short-lived task-execution units, NOT user-facing interactive sessions.
 *
 * The per-user session cap (default 5, see `lib/session-cap.ts`) limits concurrent
 * interactive sessions per user. Delegation children MUST NOT consume this slot because:
 *   - They are scoped to a single task and auto-cleaned after completion
 *   - A user actively delegating could easily exceed the cap through parallel children
 *   - Only the root Supervisor session counts toward the cap
 *
 * When `agentScope.rootSessionId !== undefined`, the implementation of the cap check
 * in `startRpcSession` MUST skip the `incrementUserSessionCap` call. The exemption
 * is identified by the presence of `agentScope.rootSessionId` — if that field is
 * populated, the session is a delegation child and must not be counted.
 *
 * (Currently `incrementUserSessionCap` is not yet called in `startRpcSession`; this
 * comment documents the contract for when it is added.)
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
  userId?: string | null,
  agentScope?: AgentScopeResolveInput,
  customTools?: ToolDefinition[],
  excludeTools?: string[],
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      // toolNames === [] -> "all off" (an empty allow-list disables every tool).
      // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
      // set allowedToolNames to coding builtins only, which filtered every
      // extension/package-provided tool (e.g. subagents, web access) out of the
      // tool registry — so they were unavailable in pi-web sessions even though the
      // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
      // tools (and activate extension tools); we narrow the ACTIVE set below.
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    // Task 2.4: resolve the four-layer skill/MCP scope when caller supplies
    // `agentScope`. Resolver failures MUST NOT crash the session — fall back
    // to an empty scope so the session can still start with whatever baseline
    // resources the SDK loads. This keeps legacy callers (no `agentScope`)
    // and DB-outage paths on their previous behavior.
    let resolvedScope: AgentScopeInput = { skills: [], mcpServers: [] };
    if (agentScope) {
      try {
        const [skills, mcp] = await Promise.all([
          resolveAgentSkills({
            agentId: agentScope.agentId,
            userId: agentScope.userId,
            teamId: agentScope.teamId,
            ...(agentScope.scope ? { scope: agentScope.scope } : {}),
          }),
          resolveAgentMcpServers({
            agentId: agentScope.agentId,
            userId: agentScope.userId,
            teamId: agentScope.teamId,
            ...(agentScope.scope ? { scope: agentScope.scope } : {}),
          }),
        ]);
        resolvedScope = { skills: skills.skills, mcpServers: mcp.mcpServers };
      } catch (err) {
        // eslint-disable-next-line no-console -- intentional: scope failure must
        // surface to logs even in production so operators can diagnose DB outages.
        console.warn(
          `[rpc-manager] four-layer scope resolution failed for agentId=${agentScope.agentId}; falling back to empty scope:`,
          err,
        );
        resolvedScope = { skills: [], mcpServers: [] };
      }
    }
    const scopeHash = computeScopeHash({
      skills: resolvedScope.skills,
      mcpServers: resolvedScope.mcpServers.map((m) => m.id),
    });

    // Build (or reuse from cache) services. The per-cwd + per-scope cache
    // avoids re-scanning the filesystem when the same user opens several
    // sessions in quick succession — each reload costs ~250MB in the SDK,
    // which is the primary driver of the OOM kills observed on 2026-07-14.
    // scopeHash is included in the cache key so two agents with different
    // skill/MCP bindings never share a cached services object. userId is
    // included so BYOK AuthStorage never leaks across tenants (Task 2.6).
    const services = await getOrCreateServices(cwd, scopeHash, agentDir, resolvedScope, userId ?? null);
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
      ...(customTools !== undefined ? { customTools } : {}),
      ...(excludeTools !== undefined ? { excludeTools } : {}),
    });

    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in pi-web just like in the `pi` CLI.
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
    }

    const wrapper = new AgentSessionWrapper(inner, userId ?? null);
    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // keep this forced after extension resource discovery and reloads as well.
    if (toolNames?.length === 0) {
      wrapper.setForceEmptySystemPrompt(true);
    }
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
