import { Link, Route, Routes } from 'react-router';
import { RecipeListPage } from './pages/RecipeListPage';
import { RecipeDetailPage } from './pages/RecipeDetailPage';
import { NewRecipePage } from './pages/NewRecipePage';
import { EditRecipePage } from './pages/EditRecipePage';
export default function App() {
    return (
        <>
            <header className="app-header">
                <Link to="/">Recipe App</Link>
            </header>

            <main className="container">
                <Routes>
                    <Route path="/" element={<RecipeListPage />} />
                    <Route path="/recipes/new" element={ <NewRecipePage />} />
                    <Route path="/recipes/:id" element={<RecipeDetailPage />} />
                    <Route path="/recipes/:id/edit" element={ <EditRecipePage/>} />
                </Routes>
            </main>
        </>
    );
}
