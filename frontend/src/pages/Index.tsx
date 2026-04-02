import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  GitBranch,
  CheckCircle2,
  CircleDashed,
  ChevronRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Header } from "@/components/Header";
import { StatsCard } from "@/components/StatsCard";
import { RequestLogTable } from "@/components/RequestLogTable";
import { mockRequestLogs, mockApiSpecs, mockStats } from "@/data/mockData";
import { mockRepositories } from "@/data/repositories";
import { Button } from "@/components/ui/button";

const Index = () => {
  const validationRate = (
    (mockStats.validRequests / mockStats.totalRequests) *
    100
  ).toFixed(1);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Total Requests"
            value={mockStats.totalRequests.toLocaleString()}
            icon={Activity}
            trend={{ value: 12.5, positive: true }}
          />
          <StatsCard
            title="Valid Contracts"
            value={`${validationRate}%`}
            icon={ShieldCheck}
            variant="success"
            trend={{ value: 2.3, positive: true }}
          />
          <StatsCard
            title="Violations"
            value={mockStats.violations.toLocaleString()}
            icon={AlertTriangle}
            variant="warning"
            trend={{ value: 5.1, positive: false }}
          />
          <StatsCard
            title="Uptime"
            value={`${mockStats.uptime}%`}
            icon={Clock}
            variant="success"
          />
        </div>

        {/* Quick Access: Repositories */}
        <div className="card-gradient rounded-lg border border-border overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <GitBranch className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  Linked Repositories
                </h3>
                <p className="text-sm text-muted-foreground">
                  {mockRepositories.length} repositories •{" "}
                  <span className="text-success">
                    {
                      mockRepositories.filter(
                        (r) => r.healthStatus === "healthy",
                      ).length
                    }{" "}
                    healthy
                  </span>
                  {mockRepositories.filter((r) => r.healthStatus === "issues")
                    .length > 0 && (
                    <>
                      {" "}
                      •{" "}
                      <span className="text-warning">
                        {
                          mockRepositories.filter(
                            (r) => r.healthStatus === "issues",
                          ).length
                        }{" "}
                        with issues
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <Link to="/repositories">
              <Button size="sm">
                <ArrowUpRight className="h-4 w-4 mr-1" />
                Link Repo
              </Button>
            </Link>
          </div>

          {/* Repository preview list */}
          <div className="divide-y divide-border/50">
            {mockRepositories.slice(0, 3).map((repo) => {
              const linkedSpec = repo.linkedSpecId
                ? mockApiSpecs.find((s) => s.id === repo.linkedSpecId)
                : null;
              return (
                <Link
                  key={repo.id}
                  to={`/repositories/${repo.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  {repo.healthStatus === "healthy" ? (
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  ) : repo.healthStatus === "issues" ? (
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                  ) : (
                    <CircleDashed className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">
                      {repo.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {linkedSpec
                        ? `Linked to ${linkedSpec.name}`
                        : "No spec linked"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            })}
          </div>

          {mockRepositories.length > 3 && (
            <Link
              to="/repositories"
              className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-primary hover:bg-muted/30 transition-colors border-t border-border/50"
            >
              View all {mockRepositories.length} repositories
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        {/* Request Log */}
        <RequestLogTable
          logs={mockRequestLogs}
          specs={mockApiSpecs}
          showApiFilter={true}
        />
      </div>
    </div>
  );
};

export default Index;

