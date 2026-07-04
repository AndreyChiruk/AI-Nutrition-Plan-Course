import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './layout/AppLayout';
import { AdminPage } from './pages/AdminPage';
import { BodyAnalysisPage } from './pages/BodyAnalysisPage';
import { ChatPage } from './pages/ChatPage';
import { DashboardPage } from './pages/DashboardPage';
import { FoodRecognitionPage } from './pages/FoodRecognitionPage';
import { LoginPage } from './pages/LoginPage';
import { MealPlanPage } from './pages/MealPlanPage';
import { MyMealPlansPage } from './pages/MyMealPlansPage';
import { MyWorkoutPlansPage } from './pages/MyWorkoutPlansPage';
import { WorkoutPlanPage } from './pages/WorkoutPlanPage';
import { ProfilePage } from './pages/ProfilePage';
import { StatsPage } from './pages/StatsPage';
import { RecommendationsPage } from './pages/RecommendationsPage';

const ProtectedRoutes = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
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
