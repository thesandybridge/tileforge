export interface Notification {
  id: string;
  type: "processing_complete" | "processing_failed" | "info" | "warning" | "error" | "changelog";
  title: string;
  message?: string;
  link?: string;
  read: boolean;
  created_at: string;
  zipUrl?: string;
  pmtilesUrl?: string;
  fileName?: string;
}
