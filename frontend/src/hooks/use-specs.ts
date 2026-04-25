import { useCallback, useEffect, useState } from "react";
import type { BackendSpecSummary, BackendSpecVersion } from "@/types/api";
import { getApiBaseUrl } from "@/hooks/use-session";
import { SPECS_API_PATH, SPECS_UPLOAD_API_PATH } from "@/lib/api-paths";

interface SpecsResponseBody {
  specs?: BackendSpecSummary[];
  code?: string;
  message?: string;
}

interface VersionsResponseBody {
  versions?: BackendSpecVersion[];
  code?: string;
  message?: string;
}

interface UploadResponseBody {
  version?: BackendSpecVersion;
  code?: string;
  message?: string;
}

export function useSpecs() {
  const [specs, setSpecs] = useState<BackendSpecSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSpecs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBaseUrl()}${SPECS_API_PATH}`, {
        credentials: "include",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as SpecsResponseBody | null;

      if (!response.ok) {
        setSpecs([]);
        setError(payload?.message ?? "Failed to load API specifications");
        return;
      }

      setSpecs(payload?.specs ?? []);
    } catch {
      setSpecs([]);
      setError("Failed to load API specifications");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSpecs();
  }, [loadSpecs]);

  const uploadSpecFile = useCallback(
    async (file: File): Promise<BackendSpecVersion> => {
      const content = await file.text();

      const response = await fetch(
        `${getApiBaseUrl()}${SPECS_UPLOAD_API_PATH}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            fileName: file.name,
            content,
          }),
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as UploadResponseBody | null;

      if (!response.ok || !payload?.version) {
        throw new Error(payload?.message ?? "Failed to upload specification");
      }

      await loadSpecs();
      return payload.version;
    },
    [loadSpecs],
  );

  const listVersions = useCallback(
    async (specId: string): Promise<BackendSpecVersion[]> => {
      const response = await fetch(
        `${getApiBaseUrl()}${SPECS_API_PATH}/${specId}/versions`,
        {
          credentials: "include",
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as VersionsResponseBody | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "Failed to load spec versions");
      }

      return payload?.versions ?? [];
    },
    [],
  );

  const deleteVersion = useCallback(
    async (versionId: string): Promise<void> => {
      const response = await fetch(
        `${getApiBaseUrl()}${SPECS_API_PATH}/versions/${versionId}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      if (response.status === 204) {
        await loadSpecs();
        return;
      }

      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;

      throw new Error(payload?.message ?? "Failed to delete spec version");
    },
    [loadSpecs],
  );

  return {
    specs,
    isLoading,
    error,
    refreshSpecs: loadSpecs,
    uploadSpecFile,
    listVersions,
    deleteVersion,
  };
}
