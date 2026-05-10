import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, ArrowRight, Github } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

const Login = () => {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

  useEffect(() => {
    let isMounted = true;

    const checkExistingSession = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/auth/me`, {
          credentials: "include",
        });

        if (response.ok && isMounted) {
          navigate("/dashboard", { replace: true });
        }
      } catch (_error) {
        // If session check fails, user stays on login page.
      }
    };

    void checkExistingSession();

    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl, navigate]);

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiBaseUrl}/auth/local/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setAuthError(payload?.message ?? "Unable to sign in");
        return;
      }

      navigate("/dashboard", { replace: true });
    } catch {
      setAuthError("Unable to sign in");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLocalSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${apiBaseUrl}/auth/local/signup`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: signupEmail,
          password: signupPassword,
          name: signupName,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setAuthError(payload?.message ?? "Unable to create account");
        return;
      }

      navigate("/dashboard", { replace: true });
    } catch {
      setAuthError("Unable to create account");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGithubAuth = () => {
    window.location.href = `${apiBaseUrl}/auth/github/login`;
  };

  const handleGoogleAuth = () => {
    window.location.href = `${apiBaseUrl}/auth/google/login`;
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left branding panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-muted/30" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/5 blur-3xl" />

        <div className="relative z-10">
          <BrandLogo size="lg" className="mb-2" />
        </div>

        <div className="relative z-10 space-y-6">
          <h2 className="text-4xl font-bold text-foreground leading-tight">
            Monitor & validate
            <br />
            <span className="text-primary">every API contract</span>
          </h2>
          <p className="text-muted-foreground max-w-md">
            Real-time OpenAPI spec validation, endpoint monitoring, and schema
            comparison—all in one dashboard.
          </p>
        </div>

        <div className="relative z-10 text-sm text-muted-foreground">
          © 2026 API Sentinel. All rights reserved.
        </div>
      </div>

      {/* Right auth form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-4">
            <BrandLogo size="sm" />
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-8">
              <TabsTrigger value="login">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLocalLogin} className="space-y-5">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="you@company.com"
                        className="pl-10"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-10 pr-10"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {authError ? (
                  <p className="text-sm text-destructive">{authError}</p>
                ) : null}

                <Button type="submit" className="w-full gap-2">
                  {isSubmitting ? "Signing in..." : "Sign In"}{" "}
                  <ArrowRight className="h-4 w-4" />
                </Button>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or continue with
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGithubAuth}
                    className="w-full gap-2"
                  >
                    <Github className="h-4 w-4" />
                    GitHub
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGoogleAuth}
                    className="w-full gap-2"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    Google
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleLocalSignup} className="space-y-5">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Full Name</Label>
                    <Input
                      id="signup-name"
                      placeholder="John Doe"
                      value={signupName}
                      onChange={(e) => setSignupName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@company.com"
                        className="pl-10"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-10 pr-10"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        minLength={8}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {authError ? (
                  <p className="text-sm text-destructive">{authError}</p>
                ) : null}

                <div className="text-xs text-muted-foreground">
                  By creating an account, you agree to our{" "}
                  <button
                    type="button"
                    className="text-primary hover:text-primary/80 underline-offset-2 hover:underline"
                    onClick={() => console.log("Terms clicked")}
                  >
                    Terms of Service
                  </button>{" "}
                  and{" "}
                  <button
                    type="button"
                    className="text-primary hover:text-primary/80 underline-offset-2 hover:underline"
                    onClick={() => console.log("Privacy clicked")}
                  >
                    Privacy Policy
                  </button>
                </div>

                <Button type="submit" className="w-full gap-2">
                  {isSubmitting ? "Creating account..." : "Create Account"}{" "}
                  <ArrowRight className="h-4 w-4" />
                </Button>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or continue with
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGithubAuth}
                    className="w-full gap-2"
                  >
                    <Github className="h-4 w-4" />
                    GitHub
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGoogleAuth}
                    className="w-full gap-2"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    Google
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default Login;
