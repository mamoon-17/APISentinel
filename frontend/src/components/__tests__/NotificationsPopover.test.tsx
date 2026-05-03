import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsPopover } from "@/components/NotificationsPopover";

// ---------- Mock data ---------------------------------------------------------

const mockLogsWithIssues = [
  {
    id: "log-1",
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    repositoryName: "my-api",
    repositoryFullName: "user/my-api",
    specName: "User Service",
    status: "error" as const,
    jobStatus: "failed" as const,
    inconsistencyCount: 3,
    endpointsCovered: 4,
    endpointsTotal: 10,
    trigger: "manual" as const,
    durationMs: 1200,
  },
  {
    id: "log-2",
    timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    repositoryName: "frontend-app",
    repositoryFullName: "user/frontend-app",
    specName: "Order API",
    status: "warning" as const,
    jobStatus: "succeeded" as const,
    inconsistencyCount: 1,
    endpointsCovered: 8,
    endpointsTotal: 12,
    trigger: "auto-on-link" as const,
    durationMs: 800,
  },
  {
    id: "log-3",
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    repositoryName: "payment-service",
    repositoryFullName: "user/payment-service",
    specName: "Payment API",
    status: "valid" as const,
    jobStatus: "succeeded" as const,
    inconsistencyCount: 0,
    endpointsCovered: 5,
    endpointsTotal: 5,
    trigger: "manual" as const,
    durationMs: 500,
  },
];

const mockLogsAllValid = [
  {
    id: "log-ok-1",
    timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    repositoryName: "clean-api",
    repositoryFullName: "user/clean-api",
    specName: "Clean Spec",
    status: "valid" as const,
    jobStatus: "succeeded" as const,
    inconsistencyCount: 0,
    endpointsCovered: 3,
    endpointsTotal: 3,
    trigger: "manual" as const,
    durationMs: 200,
  },
];

// ---------- Hook mock ---------------------------------------------------------

const mockRefetch = vi.fn();
let mockHookReturn = {
  logs: mockLogsWithIssues,
  isLoading: false,
  error: null as string | null,
  refetch: mockRefetch,
};

vi.mock("@/hooks/use-dashboard", () => ({
  useRequestLogs: () => mockHookReturn,
}));

// ---------- Tests -------------------------------------------------------------

describe("NotificationsPopover", () => {
  beforeEach(() => {
    mockHookReturn = {
      logs: mockLogsWithIssues,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the bell icon button", () => {
    render(<NotificationsPopover />);
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });

  it("shows the red notification dot when there are warning/error logs", () => {
    const { container } = render(<NotificationsPopover />);
    // The pulse dot is a span inside the button
    const dot = container.querySelector(".bg-destructive.rounded-full");
    expect(dot).toBeInTheDocument();
  });

  it("hides the red dot when all logs are valid", () => {
    mockHookReturn = {
      logs: mockLogsAllValid,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    const { container } = render(<NotificationsPopover />);
    const dot = container.querySelector(".bg-destructive.rounded-full");
    expect(dot).not.toBeInTheDocument();
  });

  it("hides the red dot when there are no logs", () => {
    mockHookReturn = {
      logs: [],
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    const { container } = render(<NotificationsPopover />);
    const dot = container.querySelector(".bg-destructive.rounded-full");
    expect(dot).not.toBeInTheDocument();
  });

  it("shows loading state when logs are loading and empty", async () => {
    mockHookReturn = {
      logs: [],
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    };
    render(<NotificationsPopover />);
    const button = screen.getByRole("button");
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Loading…")).toBeInTheDocument();
    });
  });

  it("shows 'No new notifications' when logs are loaded but all valid", async () => {
    mockHookReturn = {
      logs: mockLogsAllValid,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<NotificationsPopover />);
    const button = screen.getByRole("button");
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("No new notifications")).toBeInTheDocument();
    });
  });

  it("displays notification items with repository names for warning/error logs", async () => {
    render(<NotificationsPopover />);
    const button = screen.getByRole("button");
    await userEvent.click(button);

    await waitFor(() => {
      // error log should show
      expect(screen.getByText("user/my-api")).toBeInTheDocument();
      // warning log should show
      expect(screen.getByText("user/frontend-app")).toBeInTheDocument();
      // valid log with 0 inconsistencies should NOT show
      expect(
        screen.queryByText("user/payment-service"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows spec name and inconsistency count in notification details", async () => {
    render(<NotificationsPopover />);
    const button = screen.getByRole("button");
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Spec: User Service/)).toBeInTheDocument();
      expect(screen.getByText(/3 issues/)).toBeInTheDocument();
      expect(screen.getByText(/Spec: Order API/)).toBeInTheDocument();
      expect(screen.getByText(/1 issue(?!s)/)).toBeInTheDocument();
    });
  });

  it("shows status badges (Failed, Warning)", async () => {
    render(<NotificationsPopover />);
    const button = screen.getByRole("button");
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByText("Warning")).toBeInTheDocument();
    });
  });

  it("clears all notifications when 'Clear all' is clicked", async () => {
    render(<NotificationsPopover />);
    const button = screen.getByRole("button");
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("user/my-api")).toBeInTheDocument();
    });

    const clearButton = screen.getByText("Clear all");
    await userEvent.click(clearButton);

    await waitFor(() => {
      expect(screen.getByText("No new notifications")).toBeInTheDocument();
      expect(screen.queryByText("user/my-api")).not.toBeInTheDocument();
    });
  });

  it("does not show 'Clear all' button when there are no notifications", async () => {
    mockHookReturn = {
      logs: mockLogsAllValid,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<NotificationsPopover />);
    const button = screen.getByRole("button");
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
    });
  });

  it("filters valid logs that have inconsistencies as notifications", async () => {
    // A valid-status log that still has inconsistencies should appear
    mockHookReturn = {
      logs: [
        {
          id: "log-valid-with-issues",
          timestamp: new Date().toISOString(),
          repositoryName: "tricky-repo",
          repositoryFullName: "user/tricky-repo",
          specName: "Tricky Spec",
          status: "valid" as const,
          jobStatus: "succeeded" as const,
          inconsistencyCount: 2,
          endpointsCovered: 5,
          endpointsTotal: 5,
          trigger: "manual" as const,
          durationMs: 300,
        },
      ],
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<NotificationsPopover />);
    const button = screen.getByRole("button");
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("user/tricky-repo")).toBeInTheDocument();
      expect(screen.getByText(/2 issues/)).toBeInTheDocument();
    });
  });

  it("limits displayed notifications to 8 items", async () => {
    // Generate 12 error logs
    const manyLogs = Array.from({ length: 12 }, (_, i) => ({
      id: `many-${i}`,
      timestamp: new Date(Date.now() - 1000 * 60 * i).toISOString(),
      repositoryName: `repo-${i}`,
      repositoryFullName: `user/repo-${i}`,
      specName: `Spec ${i}`,
      status: "error" as const,
      jobStatus: "failed" as const,
      inconsistencyCount: 1,
      endpointsCovered: 1,
      endpointsTotal: 5,
      trigger: "manual" as const,
      durationMs: 100,
    }));

    mockHookReturn = {
      logs: manyLogs,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    };

    render(<NotificationsPopover />);
    const button = screen.getByRole("button");
    await userEvent.click(button);

    await waitFor(() => {
      // Only first 8 should render
      expect(screen.getByText("user/repo-0")).toBeInTheDocument();
      expect(screen.getByText("user/repo-7")).toBeInTheDocument();
      expect(screen.queryByText("user/repo-8")).not.toBeInTheDocument();
    });
  });
});
