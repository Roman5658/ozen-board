export const MAX_AD_IMAGES = 20;
export const AD_IMAGE_MAX_WIDTH = 1600;
export const AD_IMAGE_WEBP_QUALITY = 0.8;

export class ImageOptimizationError extends Error {
    readonly fileName: string;

    constructor(fileName: string, cause?: unknown) {
        super(`Failed to optimize image: ${fileName}`, { cause });
        this.name = "ImageOptimizationError";
        this.fileName = fileName;
    }
}

export async function optimizeAdImage(file: File): Promise<File> {
    if (!file.type.startsWith("image/")) {
        throw new ImageOptimizationError(file.name);
    }

    let image: DecodedImage | null = null;

    try {
        image = await decodeImage(file);

        if (image.width <= 0 || image.height <= 0) {
            throw new Error("Invalid image dimensions");
        }

        const width = Math.min(image.width, AD_IMAGE_MAX_WIDTH);
        const height = Math.max(1, Math.round(image.height * (width / image.width)));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Canvas is unavailable");
        }

        context.drawImage(image.source, 0, 0, width, height);

        const blob = await canvasToWebP(canvas);
        const baseName = file.name.replace(/\.[^.]+$/, "") || "image";

        return new File([blob], `${baseName}.webp`, {
            type: "image/webp",
            lastModified: Date.now(),
        });
    } catch (error) {
        throw new ImageOptimizationError(file.name, error);
    } finally {
        image?.dispose();
    }
}

export async function optimizeAdImages(files: readonly File[]): Promise<File[]> {
    const optimizedFiles: File[] = [];

    for (const file of files) {
        optimizedFiles.push(await optimizeAdImage(file));
    }

    return optimizedFiles;
}

type DecodedImage = {
    source: CanvasImageSource;
    width: number;
    height: number;
    dispose: () => void;
};

async function decodeImage(file: File): Promise<DecodedImage> {
    if (typeof createImageBitmap === "function") {
        try {
            const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
            return {
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                dispose: () => bitmap.close(),
            };
        } catch {
            // Some mobile browsers can decode through Image even when createImageBitmap fails.
        }
    }

    const objectUrl = URL.createObjectURL(file);

    try {
        const image = new Image();
        image.decoding = "async";
        image.src = objectUrl;

        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("Image decoding failed"));
        });

        return {
            source: image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            dispose: () => URL.revokeObjectURL(objectUrl),
        };
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
    }
}

async function canvasToWebP(canvas: HTMLCanvasElement): Promise<Blob> {
    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/webp", AD_IMAGE_WEBP_QUALITY);
    });

    if (!blob || blob.type !== "image/webp") {
        throw new Error("WebP conversion is unavailable");
    }

    return blob;
}
