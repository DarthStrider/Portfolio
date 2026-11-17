import { Link, Route, Routes } from 'react-router';
import { RecipeListPage } from './pages/RecipeListPage';
import { RecipeDetailPage } from './pages/RecipeDetailPage';

export default function App() {
    return (
        <>
            <header className="app-header">
                <Link to="/">Recipe App</Link>
            </header>

            <main className="container">
                <Routes>
                    <Route path="/" element={<RecipeListPage />} />
                    <Route path="/recipes/:id" element={<RecipeDetailPage />} />
                </Routes>
            </main>
        </>
    );
}
