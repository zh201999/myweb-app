import NetworkCanvas from "@/components/network/NetworkCanvas";

export default function DashboardPage() {
  return (
    <main className="flex h-screen bg-slate-950 text-white">
      <aside className="w-64 border-r border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-6 text-xl font-semibold">MyWeb</h2>

        <nav className="space-y-3 text-slate-300">
          <div className="cursor-pointer hover:text-white">Network Map</div>
          <div className="cursor-pointer hover:text-white">Contacts</div>
          <div className="cursor-pointer hover:text-white">Organizations</div>
          <div className="cursor-pointer hover:text-white">Settings</div>
        </nav>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4">
          <h1 className="text-lg font-medium">Dashboard</h1>

          <div className="text-sm text-slate-400">Logged in</div>
        </header>

        <div className="min-h-0 flex-1">
          <NetworkCanvas />
        </div>
      </section>
    </main>
  );
}