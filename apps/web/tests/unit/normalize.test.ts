import { describe, it, expect } from "vitest";
import { normalizeToolCalls } from "@/lib/normalize";
import type { AgentMessage, AssistantMessage, UserMessage, ToolResultMessage } from "@/lib/types";

const userMsg: UserMessage = {
  role: "user",
  content: "hello",
  timestamp: Date.now(),
};

const toolResultMsg: ToolResultMessage = {
  role: "toolResult",
  toolCallId: "tc-1",
  content: [{ type: "text", text: "ok" }],
  timestamp: Date.now(),
};

describe("normalizeToolCalls", () => {
  it("returns non-assistant messages unchanged", () => {
    expect(normalizeToolCalls(userMsg)).toBe(userMsg);
    expect(normalizeToolCalls(toolResultMsg)).toBe(toolResultMsg);
  });

  it("returns assistant message unchanged when content is not an array", () => {
    const assistant: AssistantMessage = {
      role: "assistant",
      content: "plain text",
      timestamp: Date.now(),
    };
    const out = normalizeToolCalls(assistant) as AssistantMessage;
    expect(out).toBe(assistant);
  });

  it("renames file-format toolCall fields to ToolCallContent fields", () => {
    const assistant: AgentMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "calling tool" },
        {
          type: "toolCall",
          id: "abc123",
          name: "read",
          arguments: { path: "/tmp/x" },
        },
      ],
      timestamp: Date.now(),
    };

    const out = normalizeToolCalls(assistant) as AssistantMessage;
    const toolCall = out.content[1] as any;

    expect(toolCall.toolCallId).toBe("abc123");
    expect(toolCall.toolName).toBe("read");
    expect(toolCall.input).toEqual({ path: "/tmp/x" });
    expect(toolCall.arguments).toBeUndefined();
  });

  it("keeps already-normalized toolCall fields intact", () => {
    const assistant: AgentMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          toolCallId: "tc-1",
          toolName: "write",
          input: { path: "/tmp/a", content: "hi" },
        },
      ],
      timestamp: Date.now(),
    };

    const out = normalizeToolCalls(assistant) as AssistantMessage;
    const toolCall = out.content[0] as any;

    expect(toolCall.toolCallId).toBe("tc-1");
    expect(toolCall.toolName).toBe("write");
    expect(toolCall.input).toEqual({ path: "/tmp/a", content: "hi" });
  });

  it("leaves non toolCall blocks untouched", () => {
    const assistant: AgentMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "hi" },
        { type: "thinking", text: "let me think" },
      ],
      timestamp: Date.now(),
    };

    const out = normalizeToolCalls(assistant) as AssistantMessage;
    expect(out.content).toEqual([
      { type: "text", text: "hi" },
      { type: "thinking", text: "let me think" },
    ]);
  });

  it("falls back to empty values when toolCall fields are missing", () => {
    const assistant: AgentMessage = {
      role: "assistant",
      content: [{ type: "toolCall" }],
      timestamp: Date.now(),
    };

    const out = normalizeToolCalls(assistant) as AssistantMessage;
    const toolCall = out.content[0] as any;

    expect(toolCall.toolCallId).toBe("");
    expect(toolCall.toolName).toBe("");
    expect(toolCall.input).toEqual({});
  });
});
