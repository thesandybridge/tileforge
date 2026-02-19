export interface Notification {
  id: string;
  type: "processing_complete" | "processing_failed" | "info" | "warning" | "error";
  title: string;
  message?: string;
  read: boolean;
  created_at: string;
  zipUrl?: string;
  pmtilesUrl?: string;
  fileName?: string;
}
