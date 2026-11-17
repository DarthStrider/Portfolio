import { Link, Route, Routes } from 'react-router';
import { RecipeListPage } from './pages/RecipeListPage';

export default function App() {
    return (
        <>
            <header className="app-header">
                <Link to="/">Recipe App</Link>
            </header>

            <main className="container">
                <Routes>
                    <Route path="/" element={<RecipeListPage />} />
                    <Route path="/recipes/:id" element={<p>Recipe details coming in #10</p>} />
                </Routes>
            </main>
        </>
    );
}