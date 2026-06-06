export const MAX_AD_IMAGES = 20;
export const AD_IMAGE_MAX_WIDTH = 1600;
export const AD_IMAGE_WEBP_QUALITY = 0.8;
export const IMAGE_FILE_ACCEPT = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".heif",
].join(",");

const ALLOWED_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
]);

const ALLOWED_IMAGE_EXTENSIONS = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".heif",
]);

const HEIC_IMAGE_MIME_TYPES = new Set([
    "image/heic",
    "image/heif",
]);

const HEIC_IMAGE_EXTENSIONS = new Set([
    ".heic",
    ".heif",
]);

export class UnsupportedImageFormatError extends Error {
    readonly fileName: string;

    constructor(fileName: string) {
        super(`Unsupported image format: ${fileName}`);
        this.name = "UnsupportedImageFormatError";
        this.fileName = fileName;
    }
}

export class ImageOptimizationError extends Error {
    readonly fileName: string;

    constructor(fileName: string, cause?: unknown) {
        super(`Failed to optimize image: ${fileName}`, { cause });
        this.name = "ImageOptimizationError";
        this.fileName = fileName;
    }
}

export function validateImageFile(file: File): void {
    const mimeType = getFileMimeType(file);
    const extension = getFileExtension(file);

    if (
        !ALLOWED_IMAGE_MIME_TYPES.has(mimeType) ||
        !ALLOWED_IMAGE_EXTENSIONS.has(extension)
    ) {
        throw new UnsupportedImageFormatError(file.name);
    }
}

export function validateImageFiles(files: readonly File[]): void {
    files.forEach(validateImageFile);
}

export function getImageUploadContentType(file: File): string {
    const extension = getFileExtension(file);

    if (extension === ".heif") return "image/heif";
    if (extension === ".heic") return "image/heic";

    return getFileMimeType(file);
}

export async function optimizeAdImage(file: File): Promise<File> {
    validateImageFile(file);

    let image: DecodedImage | null = null;
    const isHeicImage = isHeicOrHeifImage(file);

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
        if (isHeicImage) {
            const fallbackFile = createHeicFallbackFile(file);
            console.warn(
                `[imageOptimization] WebP conversion failed for ${file.name}. ` +
                `Uploading the original iPhone image as ${fallbackFile.type}.`,
                error,
            );
            return fallbackFile;
        }

        console.error(
            `[imageOptimization] WebP conversion failed for ${file.name}.`,
            error,
        );
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

function getFileMimeType(file: File): string {
    return file.type.trim().toLowerCase();
}

function getFileExtension(file: File): string {
    const extensionMatch = file.name.trim().toLowerCase().match(/\.[^.]+$/);
    return extensionMatch?.[0] ?? "";
}

function isHeicOrHeifImage(file: File): boolean {
    return (
        HEIC_IMAGE_MIME_TYPES.has(getFileMimeType(file)) ||
        HEIC_IMAGE_EXTENSIONS.has(getFileExtension(file))
    );
}

function createHeicFallbackFile(file: File): File {
    const originalExtension = getFileExtension(file);
    const originalMimeType = getFileMimeType(file);
    const extension = originalExtension === ".heif" || originalMimeType === "image/heif"
        ? ".heif"
        : ".heic";
    const contentType = extension === ".heif" ? "image/heif" : "image/heic";
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    const fileName = `${baseName}${extension}`;

    if (file.name === fileName && file.type === contentType) {
        return file;
    }

    return new File([file], fileName, {
        type: contentType,
        lastModified: file.lastModified,
    });
}

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
