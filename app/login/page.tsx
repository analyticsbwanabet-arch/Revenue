import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0b0d10" }}>
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="BwanaBet" className="w-20 h-20 mx-auto rounded-2xl mb-4" style={{ border: "3px solid #c9a227" }} />
          <h1 className="text-2xl font-bold" style={{ color: "#c9a227" }}>BwanaBet</h1>
          <p className="text-sm mt-1" style={{ color: "#6b7280" }}>Daily Revenue System</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
