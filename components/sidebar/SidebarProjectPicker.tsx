"use client";
import { useEffect, useState } from "react";

type Project = { id: string; name: string; rootPath: string };

export function SidebarProjectPicker({ onPick }: { onPick: (p: Project) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects").then(r => r.json()).then(d => {
      setProjects(d.projects || []);
      setLoading(false);
    });
  }, []);

  async function pick(id: string) {
    const r = await fetch(`/api/projects/${id}/bind`, { method: "POST" });
    if (r.ok) {
      const p = projects.find(x => x.id === id);
      if (p) onPick(p);
    }
  }

  if (loading) return <div>Loading projects…</div>;
  return (
    <select
      onChange={(e) => pick(e.target.value)}
      className="w-full rounded border bg-bg px-2 py-1"
      aria-label="Select project"
    >
      <option value="">Select a project…</option>
      {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.rootPath})</option>)}
    </select>
  );
}
