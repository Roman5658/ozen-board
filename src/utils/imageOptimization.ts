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

const IMAGE_MIME_TYPE_BY_EXTENSION = new Map([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".webp", "image/webp"],
    [".heic", "image/heic"],
    [".heif", "image/heif"],
]);

export class UnsupportedImageFormatError extends Error {
    readonly fileName: string;

    constructor(fileName: string) {
        super(`Unsupported image format: ${fileName}`);
        this.name = "UnsupportedImageFormatError";
        this.fileName = fileName;
    }
}

export function validateImageFile(file: File): void {
    const mimeType = getFileMimeType(file);
    const extension = getFileExtension(file);
    const hasAllowedMimeType = ALLOWED_IMAGE_MIME_TYPES.has(mimeType);
    const hasAllowedExtension = ALLOWED_IMAGE_EXTENSIONS.has(extension);

    if (
        (mimeType !== "" && !hasAllowedMimeType) ||
        (extension !== "" && !hasAllowedExtension) ||
        (!hasAllowedMimeType && !hasAllowedExtension)
    ) {
        throw new UnsupportedImageFormatError(file.name);
    }
}

export function validateImageFiles(files: readonly File[]): void {
    files.forEach(validateImageFile);
}

export function getImageUploadContentType(file: File): string {
    const mimeType = getFileMimeType(file);
    const extension = getFileExtension(file);

    if (ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
        return mimeType;
    }

    const inferredMimeType = IMAGE_MIME_TYPE_BY_EXTENSION.get(extension);
    if (inferredMimeType) {
        return inferredMimeType;
    }

    throw new UnsupportedImageFormatError(file.name);
}

export async function optimizeAdImage(file: File): Promise<File> {
    validateImageFile(file);

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
        const fallbackFile = createOriginalImageFallback(file);
        console.warn(
            `[imageOptimization] WebP conversion failed for ${file.name}. ` +
            `Uploading the original safe image as ${fallbackFile.type}.`,
            error,
        );
        return fallbackFile;
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

function createOriginalImageFallback(file: File): File {
    const contentType = getImageUploadContentType(file);

    if (file.type === contentType) {
        return file;
    }

    return new File([file], file.name, {
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
