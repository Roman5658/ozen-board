import { useId, useState, type ReactNode } from "react";

type Props = {
    title: string;
    resetLabel: string;
    activeLabels: string[];
    onReset: () => void;
    children: ReactNode;
};

function FilterDisclosure({ title, resetLabel, activeLabels, onReset, children }: Props) {
    const [open, setOpen] = useState(false);
    const contentId = useId();

    return (
        <section className="filter-disclosure">
            <div className="filter-disclosure__heading">
                <button
                    className="filter-disclosure__toggle"
                    type="button"
                    aria-expanded={open}
                    aria-controls={contentId}
                    onClick={() => setOpen((current) => !current)}
                >
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="filter-disclosure__icon">
                        <path d="M3 4h14l-5.5 6.2v4.3l-3 1.5v-5.8L3 4Z" />
                    </svg>
                    <span>{title}</span>
                    {activeLabels.length > 0 && (
                        <span className="filter-disclosure__count" aria-label={`${activeLabels.length}`}>
                            {activeLabels.length}
                        </span>
                    )}
                    <svg aria-hidden="true" viewBox="0 0 20 20" className={`filter-disclosure__chevron${open ? " is-open" : ""}`}>
                        <path d="m5 7 5 5 5-5" />
                    </svg>
                </button>
                {activeLabels.length > 0 && (
                    <button type="button" className="filter-disclosure__reset" onClick={onReset}>
                        {resetLabel}
                    </button>
                )}
            </div>

            {activeLabels.length > 0 && (
                <div className="filter-disclosure__summary" aria-label={title}>
                    {activeLabels.map((label) => (
                        <span key={label} className="filter-disclosure__chip">{label}</span>
                    ))}
                </div>
            )}

            {open && (
                <div className="filter-disclosure__body" id={contentId}>
                    {children}
                </div>
            )}
        </section>
    );
}

export default FilterDisclosure;
