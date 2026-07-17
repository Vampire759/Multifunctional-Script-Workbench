import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Scheduler from "./pages/Scheduler";
import Downloads from "./pages/Downloads";
import LogCenter from "./pages/LogCenter";
import Tasks from "./pages/Tasks";
import Scripts from "./pages/Scripts";
import Profile from "./pages/Profile";
import LocalScreen from "./pages/LocalScreen";
import PackageSettings from "./pages/PackageSettings";

import Login from "./pages/Login";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/*" element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/scheduler" element={<Scheduler />} />
                <Route path="/downloads" element={<Downloads />} />
                <Route path="/logs" element={<LogCenter />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/scripts" element={<Scripts />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/local-screen" element={<LocalScreen />} />
                <Route path="/packages" element={<PackageSettings />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        } />
      </Routes>
    </Router>
  );
}