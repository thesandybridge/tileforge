"use client";

import Link from "next/link";
import { Bell, CheckCircle, XCircle, Info, AlertTriangle, Download, PartyPopper } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import { useNotifications } from "@/components/notification-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Notification } from "@/lib/notifications";

function NotificationIcon({ type }: { type: Notification["type"] }) {
  switch (type) {
    case "processing_complete":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "processing_failed":
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "changelog":
      return <PartyPopper className="h-4 w-4 text-primary" />;
    default:
      return <Info className="h-4 w-4 text-blue-500" />;
  }
}

function downloadFile(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

function DownloadButtons({ n }: { n: Notification }) {
  if (n.type !== "processing_complete" || !n.zipUrl) return null;

  const baseName = n.fileName?.replace(/\.[^.]+$/, "") ?? "tiles";

  return (
    <div className="mt-1.5 flex gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-[10px]"
        onClick={(e) => {
          e.stopPropagation();
          downloadFile(n.zipUrl!, `${baseName}_tiles.zip`);
        }}
      >
        <Download className="mr-1 h-3 w-3" />
        ZIP
      </Button>
      {n.pmtilesUrl && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={(e) => {
            e.stopPropagation();
            downloadFile(n.pmtilesUrl!, `${baseName}_tiles.pmtiles`);
          }}
        >
          <Download className="mr-1 h-3 w-3" />
          PMTiles
        </Button>
      )}
    </div>
  );
}

export function NotificationPanel() {
  const { notifications, unreadCount, markAllRead, clear } = useNotifications();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2">
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          {notifications.length > 0 && (
            <div className="flex gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 py-1 text-xs"
                  onClick={markAllRead}
                >
                  Mark all read
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-auto px-2 py-1 text-xs"
                onClick={clear}
              >
                Clear
              </Button>
            </div>
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
              No notifications yet
            </p>
          ) : (
            notifications.map((n) => {
              const content = (
                <div
                  className={`flex gap-3 px-3 py-2.5 ${
                    n.read ? "opacity-60" : ""
                  } ${n.link ? "hover:bg-muted/50 transition-colors" : ""}`}
                >
                  <div className="mt-0.5 shrink-0">
                    <NotificationIcon type={n.type} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight">{n.title}</p>
                    {n.message && (
                      <p className="text-muted-foreground mt-0.5 text-xs">{n.message}</p>
                    )}
                    <DownloadButtons n={n} />
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {timeAgo(n.created_at)}
                    </p>
                  </div>
                </div>
              );
              return n.link ? (
                <Link key={n.id} href={n.link} className="block">
                  {content}
                </Link>
              ) : (
                <div key={n.id}>{content}</div>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
