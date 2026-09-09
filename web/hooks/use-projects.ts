"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createProject, deleteProject, listProjects, updateTileSet } from "@/lib/api";

export function useProjects() {
  const { data: session } = useSession();
  return useQuery({ queryKey: ["projects", session?.user?.id], queryFn: () => listProjects(session!.accessToken!), enabled: !!session?.accessToken });
}

export function useProjectActions() {
  const { data: session } = useSession();
  const client = useQueryClient();
  const refresh = () => { client.invalidateQueries({ queryKey: ["projects"] }); client.invalidateQueries({ queryKey: ["tilesets"] }); };
  return {
    create: useMutation({ mutationFn: (input: { name: string; description?: string }) => createProject(input, session!.accessToken!), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => deleteProject(id, session!.accessToken!), onSuccess: refresh }),
    assign: useMutation({ mutationFn: ({ slug, projectId }: { slug: string; projectId: string | null }) => updateTileSet(slug, projectId ? { project_id: projectId } : { clear_project: true }, session!.accessToken), onSuccess: refresh }),
  };
}
