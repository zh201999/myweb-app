import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="text-center px-6">
        <h1 className="text-5xl font-bold tracking-tight mb-4">MyWeb</h1>

        <p className="text-lg text-slate-300 mb-8">
          Build, organize, and visualize your professional network.
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link
            href="/login"
            className="rounded-xl bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-500 transition"
          >
            Log In
          </Link>

          <button className="rounded-xl border border-slate-600 px-6 py-3 text-white font-medium hover:bg-slate-800 transition">
            Learn More
          </button>
        </div>
      </div>
    </main>
  );
}