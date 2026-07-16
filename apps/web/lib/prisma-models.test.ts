// lib/prisma-models.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "./prisma";

describe("M3 models", () => {
  it("creates an Agent (digital employee)", async () => {
    const agent = await prisma.agent.create({
      data: {
        name: "代码审查员",
        description: "review code",
        systemPrompt: "you are a reviewer",
        model: "anthropic/claude-opus-4-8",
        scope: "personal",
      },
    });
    expect(agent.id).toBeTruthy();
    expect(agent.scope).toBe("personal");
    await prisma.agent.delete({ where: { id: agent.id } });
  });
});
