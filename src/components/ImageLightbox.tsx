import { useEffect, useRef } from "react";
import { handleListingImageError } from "../utils/getAdImages";

type Props = {
    images: string[];
    currentIndex: number;
    title: string;
    onIndexChange: (index: number) => void;
    onClose: () => void;
};

const SWIPE_THRESHOLD = 45;

function ImageLightbox({
    images,
    currentIndex,
    title,
    onIndexChange,
    onClose,
}: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const pointerStart = useRef<{ x: number; y: number } | null>(null);
    const hasMultipleImages = images.length > 1;
    const currentImage = images[currentIndex];

    function showPrevious() {
        if (!hasMultipleImages) return;
        onIndexChange((currentIndex - 1 + images.length) % images.length);
    }

    function showNext() {
        if (!hasMultipleImages) return;
        onIndexChange((currentIndex + 1) % images.length);
    }

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialogRef.current?.focus();

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                onClose();
                return;
            }

            if (event.key === "ArrowLeft" && hasMultipleImages) {
                event.preventDefault();
                onIndexChange((currentIndex - 1 + images.length) % images.length);
            }

            if (event.key === "ArrowRight" && hasMultipleImages) {
                event.preventDefault();
                onIndexChange((currentIndex + 1) % images.length);
            }
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [
        currentIndex,
        hasMultipleImages,
        images.length,
        onClose,
        onIndexChange,
    ]);

    if (!currentImage) return null;

    return (
        <div
            ref={dialogRef}
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <button
                type="button"
                className="image-lightbox__close"
                aria-label="Close gallery"
                onClick={onClose}
            >
                ×
            </button>

            {hasMultipleImages && (
                <button
                    type="button"
                    className="image-lightbox__arrow image-lightbox__arrow--previous"
                    aria-label="Previous photo"
                    onClick={showPrevious}
                >
                    ‹
                </button>
            )}

            <div
                className="image-lightbox__stage"
                onPointerDown={(event) => {
                    pointerStart.current = { x: event.clientX, y: event.clientY };
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerUp={(event) => {
                    const start = pointerStart.current;
                    pointerStart.current = null;
                    if (!start || !hasMultipleImages) return;

                    const deltaX = event.clientX - start.x;
                    const deltaY = event.clientY - start.y;
                    if (
                        Math.abs(deltaX) < SWIPE_THRESHOLD ||
                        Math.abs(deltaX) <= Math.abs(deltaY)
                    ) {
                        return;
                    }

                    if (deltaX < 0) showNext();
                    else showPrevious();
                }}
                onPointerCancel={() => {
                    pointerStart.current = null;
                }}
            >
                <img
                    key={`${currentIndex}-${currentImage}`}
                    className="image-lightbox__image"
                    src={currentImage}
                    alt={`${title} ${currentIndex + 1}`}
                    onError={handleListingImageError}
                    draggable={false}
                />
            </div>

            {hasMultipleImages && (
                <button
                    type="button"
                    className="image-lightbox__arrow image-lightbox__arrow--next"
                    aria-label="Next photo"
                    onClick={showNext}
                >
                    ›
                </button>
            )}

            <div className="image-lightbox__counter">
                {currentIndex + 1} / {images.length}
            </div>

            {hasMultipleImages && (
                <div className="image-lightbox__thumbnails" aria-label="Photo thumbnails">
                    {images.map((image, index) => (
                        <button
                            type="button"
                            key={`${image}-${index}`}
                            className={`image-lightbox__thumbnail${
                                index === currentIndex
                                    ? " image-lightbox__thumbnail--active"
                                    : ""
                            }`}
                            aria-label={`Photo ${index + 1}`}
                            aria-current={index === currentIndex ? "true" : undefined}
                            onClick={() => onIndexChange(index)}
                        >
                            <img
                                src={image}
                                alt=""
                                onError={handleListingImageError}
                                draggable={false}
                            />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default ImageLightbox;
