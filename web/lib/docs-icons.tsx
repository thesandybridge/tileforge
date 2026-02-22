import {
  BookOpen,
  BookMarked,
  Globe,
  Key,
  Layers,
  Map,
  MapPin,
  Newspaper,
  Rocket,
  Server,
  Shield,
  Terminal,
  Zap,
} from "lucide-react";

const iconMap: Record<string, React.ReactNode> = {
  BookOpen: <BookOpen className="h-4 w-4" />,
  BookMarked: <BookMarked className="h-4 w-4" />,
  Globe: <Globe className="h-4 w-4" />,
  Key: <Key className="h-4 w-4" />,
  Layers: <Layers className="h-4 w-4" />,
  Map: <Map className="h-4 w-4" />,
  MapPin: <MapPin className="h-4 w-4" />,
  Newspaper: <Newspaper className="h-4 w-4" />,
  Rocket: <Rocket className="h-4 w-4" />,
  Server: <Server className="h-4 w-4" />,
  Shield: <Shield className="h-4 w-4" />,
  Terminal: <Terminal className="h-4 w-4" />,
  Zap: <Zap className="h-4 w-4" />,
};

export function getDocIcon(name?: string) {
  if (!name) return null;
  return iconMap[name] ?? null;
}
