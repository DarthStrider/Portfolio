interface CategoryChipsProps {
    names: (string | null)[];
}

export function CategoryChips({ names }: CategoryChipsProps) {
    const shown = names.filter((name): name is string => name !== null);
    if (shown.length === 0) return null;

    return (
        <ul className="chips">
            {shown.map((name) => (
                <li key={name} className="chip">{name}</li>
            ))}
        </ul>
    );
}
