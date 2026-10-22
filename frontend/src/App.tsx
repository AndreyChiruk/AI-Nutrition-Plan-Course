import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './layout/AppLayout';
import { ChatPage } from './pages/ChatPage';
import { DashboardPage } from './pages/DashboardPage';
import { FoodRecognitionPage } from './pages/FoodRecognitionPage';
import { FridgePage } from './pages/FridgePage';
import { LoginPage } from './pages/LoginPage';
import { MyMealPlansPage } from './pages/MyMealPlansPage';
import { MyWorkoutPlansPage } from './pages/MyWorkoutPlansPage';
import { ProfilePage } from './pages/ProfilePage';
import { RecommendationsPage } from './pages/RecommendationsPage';

const MealPlanPage = lazy(() => import('./pages/MealPlanPage').then((m) => ({ default: m.MealPlanPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const StatsPage = lazy(() => import('./pages/StatsPage').then((m) => ({ default: m.StatsPage })));
const WorkoutPlanPage = lazy(() => import('./pages/WorkoutPlanPage').then((m) => ({ default: m.WorkoutPlanPage })));
const BodyAnalysisPage = lazy(() => import('./pages/BodyAnalysisPage').then((m) => ({ default: m.BodyAnalysisPage })));

const ProtectedRoutes = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  return (
    <Suspense fallback={<p className="muted">Загрузка…</p>}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/fridge" element={<FridgePage />} />
          <Route path="/body-analysis" element={<BodyAnalysisPage />} />
          <Route path="/meal-plan" element={<MealPlanPage />} />
          <Route path="/meal-plans" element={<MyMealPlansPage />} />
          <Route path="/workout-plan" element={<WorkoutPlanPage />} />
          <Route path="/workout-plans" element={<MyWorkoutPlansPage />} />
          <Route path="/food" element={<FoodRecognitionPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route
            path="/admin"
            element={user.role === 'admin' ? <AdminPage /> : <Navigate to="/" replace />}
          />
        </Route>
      </Routes>
    </Suspense>
  );
};

function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}

export default App;
