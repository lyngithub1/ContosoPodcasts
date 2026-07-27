import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { Dashboard } from './pages/Dashboard';
import { NewProject } from './pages/NewProject';
import { ProjectWorkspace } from './pages/ProjectWorkspace';
import { PronunciationLibrary } from './pages/PronunciationLibrary';
import { Recipients } from './pages/Recipients';
import { Admin } from './pages/Admin';
import { AuditTrail } from './pages/AuditTrail';
import { Templates } from './pages/Templates';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects/new" element={<NewProject />} />
        <Route path="/projects/:projectId" element={<ProjectWorkspace />} />
        <Route path="/projects/:projectId/:stage" element={<ProjectWorkspace />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/pronunciation" element={<PronunciationLibrary />} />
        <Route path="/recipients" element={<Recipients />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/audit" element={<AuditTrail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
