import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { mockSpecDetails } from "@/data/specDetails";
import { mockApiSpecs } from "@/data/mockData";

const SpecDetail = () => {
  const { id } = useParams<{ id: string }>();
  const spec = id ? mockSpecDetails[id] : null;
  const apiSpec = mockApiSpecs.find((s) => s.id === id);

  if (!spec || !apiSpec) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Spec Not Found
          </h2>
          <Link to="/dashboard">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-6 space-y-6">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        
        <div>
          <h1 className="text-2xl font-bold">{spec.name}</h1>
        </div>
      </div>
    </div>
  );
};

export default SpecDetail;