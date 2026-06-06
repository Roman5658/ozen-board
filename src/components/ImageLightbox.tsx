import { useCallback, useEffect, useRef, useState } from "react";
import { handleListingImageError } from "../utils/getAdImages";

type Props = {
    images: string[];
    currentIndex: number;
    title: string;
    onIndexChange: (index: number) => void;
    onClose: () => void;
};

type Point = {
    x: number;
    y: number;
};

type ZoomState = Point & {
    scale: number;
};

type PointerGesture = Point & {
    lastX: number;
    lastY: number;
    pointerType: string;
};

type PinchGesture = {
    startDistance: number;
    startScale: number;
    contentX: number;
    contentY: number;
};

const SWIPE_THRESHOLD = 45;
const DOUBLE_TAP_DELAY = 320;
const DOUBLE_TAP_DISTANCE = 28;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;
const DEFAULT_ZOOM = 2;

const INITIAL_ZOOM: ZoomState = {
    scale: 1,
    x: 0,
    y: 0,
};

function ImageLightbox({
    images,
    currentIndex,
    title,
    onIndexChange,
    onClose,
}: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const activePointers = useRef(new Map<number, Point>());
    const pointerGesture = useRef<PointerGesture | null>(null);
    const pinchGesture = useRef<PinchGesture | null>(null);
    const lastTap = useRef<(Point & { time: number }) | null>(null);
    const zoomRef = useRef<ZoomState>(INITIAL_ZOOM);
    const [zoom, setZoom] = useState<ZoomState>(INITIAL_ZOOM);
    const [isPanning, setIsPanning] = useState(false);
    const hasMultipleImages = images.length > 1;
    const currentImage = images[currentIndex];

    const getPanBounds = useCallback((scale: number) => {
        const stage = stageRef.current;
        const image = imageRef.current;
        if (!stage || !image || scale <= 1) return { x: 0, y: 0 };

        return {
            x: Math.max(0, (image.clientWidth * scale - stage.clientWidth) / 2),
            y: Math.max(0, (image.clientHeight * scale - stage.clientHeight) / 2),
        };
    }, []);

    const applyZoom = useCallback(
        (scale: number, x: number, y: number) => {
            const nextScale = Math.min(MAX_ZOOM, Math.max(1, scale));
            const bounds = getPanBounds(nextScale);
            const nextZoom = nextScale === 1
                ? INITIAL_ZOOM
                : {
                    scale: nextScale,
                    x: Math.min(bounds.x, Math.max(-bounds.x, x)),
                    y: Math.min(bounds.y, Math.max(-bounds.y, y)),
                };

            zoomRef.current = nextZoom;
            setZoom(nextZoom);
        },
        [getPanBounds],
    );

    const resetZoom = useCallback(() => {
        zoomRef.current = INITIAL_ZOOM;
        setZoom(INITIAL_ZOOM);
        activePointers.current.clear();
        pointerGesture.current = null;
        pinchGesture.current = null;
        setIsPanning(false);
    }, []);

    const zoomAt = useCallback(
        (nextScale: number, clientX?: number, clientY?: number) => {
            const current = zoomRef.current;
            const stage = stageRef.current;

            if (
                nextScale <= 1 ||
                !stage ||
                clientX === undefined ||
                clientY === undefined
            ) {
                applyZoom(nextScale, current.x, current.y);
                return;
            }

            const rect = stage.getBoundingClientRect();
            const focalX = clientX - rect.left - rect.width / 2;
            const focalY = clientY - rect.top - rect.height / 2;
            const scaleRatio = nextScale / current.scale;

            applyZoom(
                nextScale,
                focalX - (focalX - current.x) * scaleRatio,
                focalY - (focalY - current.y) * scaleRatio,
            );
        },
        [applyZoom],
    );

    const changeImage = useCallback(
        (index: number) => {
            resetZoom();
            onIndexChange(index);
        },
        [onIndexChange, resetZoom],
    );

    const showPrevious = useCallback(() => {
        if (!hasMultipleImages) return;
        changeImage((currentIndex - 1 + images.length) % images.length);
    }, [
        changeImage,
        currentIndex,
        hasMultipleImages,
        images.length,
    ]);

    const showNext = useCallback(() => {
        if (!hasMultipleImages) return;
        changeImage((currentIndex + 1) % images.length);
    }, [
        changeImage,
        currentIndex,
        hasMultipleImages,
        images.length,
    ]);

    const closeLightbox = useCallback(() => {
        resetZoom();
        onClose();
    }, [onClose, resetZoom]);

    const toggleZoom = useCallback(
        (clientX?: number, clientY?: number) => {
            if (zoomRef.current.scale > 1) {
                resetZoom();
            } else {
                zoomAt(DEFAULT_ZOOM, clientX, clientY);
            }
        },
        [resetZoom, zoomAt],
    );

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialogRef.current?.focus();

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                closeLightbox();
                return;
            }

            if (event.key === "ArrowLeft" && hasMultipleImages) {
                event.preventDefault();
                showPrevious();
            }

            if (event.key === "ArrowRight" && hasMultipleImages) {
                event.preventDefault();
                showNext();
            }

            if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                zoomAt(zoomRef.current.scale + ZOOM_STEP);
            }

            if (event.key === "-") {
                event.preventDefault();
                zoomAt(zoomRef.current.scale - ZOOM_STEP);
            }

            if (event.key === "0") {
                event.preventDefault();
                resetZoom();
            }
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [
        closeLightbox,
        hasMultipleImages,
        resetZoom,
        showNext,
        showPrevious,
        zoomAt,
    ]);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;

        function handleWheel(event: WheelEvent) {
            event.preventDefault();
            const direction = event.deltaY < 0 ? 1 : -1;
            zoomAt(
                zoomRef.current.scale + direction * ZOOM_STEP,
                event.clientX,
                event.clientY,
            );
        }

        stage.addEventListener("wheel", handleWheel, { passive: false });
        return () => stage.removeEventListener("wheel", handleWheel);
    }, [zoomAt]);

    useEffect(() => {
        function handleResize() {
            const current = zoomRef.current;
            applyZoom(current.scale, current.x, current.y);
        }

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [applyZoom]);

    function startPinch() {
        const points = [...activePointers.current.values()];
        const stage = stageRef.current;
        if (points.length < 2 || !stage) return;

        const [first, second] = points;
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        if (distance === 0) return;

        const rect = stage.getBoundingClientRect();
        const centerX = (first.x + second.x) / 2 - rect.left - rect.width / 2;
        const centerY = (first.y + second.y) / 2 - rect.top - rect.height / 2;
        const current = zoomRef.current;

        pinchGesture.current = {
            startDistance: distance,
            startScale: current.scale,
            contentX: (centerX - current.x) / current.scale,
            contentY: (centerY - current.y) / current.scale,
        };
        pointerGesture.current = null;
        setIsPanning(true);
    }

    function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
        activePointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
        });
        event.currentTarget.setPointerCapture(event.pointerId);

        if (activePointers.current.size === 1) {
            pointerGesture.current = {
                x: event.clientX,
                y: event.clientY,
                lastX: event.clientX,
                lastY: event.clientY,
                pointerType: event.pointerType,
            };
            if (zoomRef.current.scale > 1) setIsPanning(true);
        } else if (activePointers.current.size === 2) {
            startPinch();
        }
    }

    function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
        if (!activePointers.current.has(event.pointerId)) return;

        activePointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
        });

        if (activePointers.current.size >= 2) {
            if (!pinchGesture.current) startPinch();
            const pinch = pinchGesture.current;
            const stage = stageRef.current;
            const points = [...activePointers.current.values()];
            if (!pinch || !stage || points.length < 2) return;

            const [first, second] = points;
            const distance = Math.hypot(second.x - first.x, second.y - first.y);
            const rect = stage.getBoundingClientRect();
            const centerX = (first.x + second.x) / 2 - rect.left - rect.width / 2;
            const centerY = (first.y + second.y) / 2 - rect.top - rect.height / 2;
            const nextScale = pinch.startScale * (distance / pinch.startDistance);

            applyZoom(
                nextScale,
                centerX - pinch.contentX * nextScale,
                centerY - pinch.contentY * nextScale,
            );
            return;
        }

        const gesture = pointerGesture.current;
        if (!gesture || zoomRef.current.scale <= 1) return;

        const deltaX = event.clientX - gesture.lastX;
        const deltaY = event.clientY - gesture.lastY;
        gesture.lastX = event.clientX;
        gesture.lastY = event.clientY;
        const current = zoomRef.current;
        applyZoom(current.scale, current.x + deltaX, current.y + deltaY);
    }

    function handleTouchTap(event: React.PointerEvent<HTMLDivElement>, gesture: PointerGesture) {
        if (gesture.pointerType !== "touch") return false;

        const moved = Math.hypot(
            event.clientX - gesture.x,
            event.clientY - gesture.y,
        );
        if (moved > 12) return false;

        const now = Date.now();
        const previousTap = lastTap.current;
        if (
            previousTap &&
            now - previousTap.time <= DOUBLE_TAP_DELAY &&
            Math.hypot(
                event.clientX - previousTap.x,
                event.clientY - previousTap.y,
            ) <= DOUBLE_TAP_DISTANCE
        ) {
            lastTap.current = null;
            toggleZoom(event.clientX, event.clientY);
            return true;
        }

        lastTap.current = {
            time: now,
            x: event.clientX,
            y: event.clientY,
        };
        return false;
    }

    function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
        const pointerCount = activePointers.current.size;
        const gesture = pointerGesture.current;

        if (pointerCount === 1 && gesture) {
            const deltaX = event.clientX - gesture.x;
            const deltaY = event.clientY - gesture.y;

            if (zoomRef.current.scale <= 1) {
                const isSwipe =
                    hasMultipleImages &&
                    Math.abs(deltaX) >= SWIPE_THRESHOLD &&
                    Math.abs(deltaX) > Math.abs(deltaY);

                if (isSwipe) {
                    lastTap.current = null;
                    if (deltaX < 0) showNext();
                    else showPrevious();
                } else {
                    handleTouchTap(event, gesture);
                }
            } else {
                handleTouchTap(event, gesture);
            }
        }

        activePointers.current.delete(event.pointerId);
        pinchGesture.current = null;

        const remainingPointer = [...activePointers.current.entries()][0];
        if (remainingPointer && zoomRef.current.scale > 1) {
            const [pointerId, point] = remainingPointer;
            pointerGesture.current = {
                ...point,
                lastX: point.x,
                lastY: point.y,
                pointerType: pointerId === event.pointerId
                    ? event.pointerType
                    : "touch",
            };
        } else {
            pointerGesture.current = null;
            setIsPanning(false);
        }
    }

    function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
        activePointers.current.delete(event.pointerId);
        pointerGesture.current = null;
        pinchGesture.current = null;
        setIsPanning(false);
    }

    if (!currentImage) return null;

    const isZoomed = zoom.scale > 1;

    return (
        <div
            ref={dialogRef}
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeLightbox();
            }}
        >
            <div className="image-lightbox__zoom-controls" aria-label="Zoom controls">
                <button
                    type="button"
                    aria-label="Zoom out"
                    title="Zoom out"
                    disabled={zoom.scale <= 1}
                    onClick={() => zoomAt(zoom.scale - ZOOM_STEP)}
                >
                    −
                </button>
                <span>{Math.round(zoom.scale * 100)}%</span>
                <button
                    type="button"
                    aria-label="Zoom in"
                    title="Zoom in"
                    disabled={zoom.scale >= MAX_ZOOM}
                    onClick={() => zoomAt(zoom.scale + ZOOM_STEP)}
                >
                    +
                </button>
                <button
                    type="button"
                    aria-label="Reset zoom"
                    title="Reset zoom"
                    disabled={!isZoomed}
                    onClick={resetZoom}
                >
                    1:1
                </button>
            </div>

            <button
                type="button"
                className="image-lightbox__close"
                aria-label="Close gallery"
                onClick={closeLightbox}
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
                ref={stageRef}
                className={`image-lightbox__stage${
                    isZoomed ? " image-lightbox__stage--zoomed" : ""
                }${isPanning ? " image-lightbox__stage--panning" : ""}`}
                onDoubleClick={(event) => {
                    toggleZoom(event.clientX, event.clientY);
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
            >
                <div
                    className="image-lightbox__zoom-surface"
                    style={{
                        transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`,
                    }}
                >
                    <img
                        ref={imageRef}
                        key={`${currentIndex}-${currentImage}`}
                        className="image-lightbox__image"
                        src={currentImage}
                        alt={`${title} ${currentIndex + 1}`}
                        onLoad={() => {
                            const current = zoomRef.current;
                            applyZoom(current.scale, current.x, current.y);
                        }}
                        onError={handleListingImageError}
                        draggable={false}
                    />
                </div>
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
                            onClick={() => changeImage(index)}
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
