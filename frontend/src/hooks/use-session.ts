import { useCallback, useEffect, useState } from "react";

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface SessionState {
  user: SessionUser | null;
  githubLinked: boolean;
  requiresLocalPassword: boolean;
}

interface SessionResponseBody {
  user?: SessionUser;
  githubLinked?: boolean;
  requiresLocalPassword?: boolean;
}

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

export function useSession(): {
  session: SessionState | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
} {
  const [session, setSession] = useState<SessionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/auth/me`, {
        credentials: "include",
      });

      if (!response.ok) {
        setSession(null);
        return;
      }

      const payload = (await response.json()) as SessionResponseBody;
      if (!payload.user) {
        setSession(null);
        return;
      }

      setSession({
        user: payload.user,
        githubLinked: Boolean(payload.githubLinked),
        requiresLocalPassword: Boolean(payload.requiresLocalPassword),
      });
    } catch {
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { session, isLoading, refresh };
}
