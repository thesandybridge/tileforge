"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PLAN_PRO } from "@/lib/plans";
import type { Notification } from "@/lib/notifications";
import {
  fetchNotifications,
  createServerNotification,
  markNotificationsRead,
  clearNotifications as clearServerNotifications,
} from "@/lib/api";

type NewNotification = Pick<Notification, "type" | "title" | "message"> &
  Partial<Pick<Notification, "zipUrl" | "pmtilesUrl" | "fileName">>;

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  add: (n: NewNotification) => void;
  markAllRead: () => void;
  clear: () => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  add: () => {},
  markAllRead: () => {},
  clear: () => {},
});

function toastForType(type: Notification["type"], title: string) {
  switch (type) {
    case "processing_complete":
      toast.success(title);
      break;
    case "processing_failed":
    case "error":
      toast.error(title);
      break;
    case "warning":
      toast.warning(title);
      break;
    default:
      toast(title);
  }
}

/**
 * Single provider component — never conditionally swaps, so children
 * (including TileforgeProvider / WASM worker) are never remounted.
 *
 * Free users: in-memory only.
 * Pro users: in-memory + server sync in background.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const isPro = session?.user?.plan === PLAN_PRO && !!session?.accessToken;
  const token = session?.accessToken ?? "";

  const [localNotifications, setLocalNotifications] = useState<Notification[]>([]);

  const { data: serverNotifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => fetchNotifications(token),
    enabled: isPro,
    refetchInterval: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: { type: string; title: string; message?: string }) =>
      createServerNotification(token, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markReadMutation = useMutation({
    mutationFn: () => markNotificationsRead(token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearServerNotifications(token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const notifications = useMemo(
    () => (isPro ? [...localNotifications, ...serverNotifications] : localNotifications),
    [isPro, localNotifications, serverNotifications],
  );

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const add = useCallback(
    (n: NewNotification) => {
      const notification: Notification = {
        id: crypto.randomUUID(),
        type: n.type,
        title: n.title,
        message: n.message,
        read: false,
        created_at: new Date().toISOString(),
        zipUrl: n.zipUrl,
        pmtilesUrl: n.pmtilesUrl,
        fileName: n.fileName,
      };
      setLocalNotifications((prev) => [notification, ...prev]);

      if (isPro) {
        createMutation.mutate({
          type: n.type,
          title: n.title,
          message: n.message,
        });
      }

      toastForType(n.type, n.title);
    },
    [isPro, createMutation],
  );

  const markAllRead = useCallback(() => {
    setLocalNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (isPro) markReadMutation.mutate();
  }, [isPro, markReadMutation]);

  const clear = useCallback(() => {
    setLocalNotifications([]);
    if (isPro) clearMutation.mutate();
  }, [isPro, clearMutation]);

  const value = useMemo(
    () => ({ notifications, unreadCount, add, markAllRead, clear }),
    [notifications, unreadCount, add, markAllRead, clear],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
