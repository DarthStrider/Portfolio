import { Link } from 'react-router';

// Shown when a recipe id doesn't exist or isn't a number
export function NotFound() {
    return (
        <div className="status">
            <p>Recipe not found.</p>
            <Link to="/" className="back-link">← Back to recipes</Link>
        </div>
    );
}
