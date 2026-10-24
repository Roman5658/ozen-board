type Props = {
    name: string;
    title: string;
    price: string;
    description: string;
    meta?: string;
    checked: boolean;
    disabled?: boolean;
    onSelect: () => void;
};

function PromotionCard({ name, title, price, description, meta, checked, disabled = false, onSelect }: Props) {
    return (
        <label className="promotion-card">
            <input
                type="radio"
                name={name}
                checked={checked}
                disabled={disabled}
                onChange={onSelect}
            />
            <span className="promotion-card__content">
                <span className="promotion-card__heading">
                    <span className="promotion-card__title">{title}</span>
                    <span className="promotion-card__price">{price}</span>
                </span>
                <span className="promotion-card__description">{description}</span>
                {meta && <span className="promotion-card__meta">{meta}</span>}
            </span>
        </label>
    );
}

export default PromotionCard;
