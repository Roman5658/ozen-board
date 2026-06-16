import { useEffect, useRef, type CSSProperties } from 'react'
import '../styles/weatherEffects.css'
import type { LiveWeatherCondition } from './liveWeatherDev'

type Props = {
    enabled: boolean
    condition: LiveWeatherCondition | null
}

type Raindrop = {
    x: number
    y: number
    length: number
    speed: number
    drift: number
    opacity: number
    width: number
    shape: 'bead' | 'trail'
}

type GlassDrop = {
    x: number
    y: number
    radiusX: number
    radiusY: number
    trailLength: number
    opacity: number
    age: number
    life: number
    slideSpeed: number
    phase: number
}

type Snowflake = {
    x: number
    y: number
    radius: number
    speed: number
    drift: number
    opacity: number
    phase: number
    rotation: number
    rotationSpeed: number
    shape: 'dot' | 'cross' | 'star'
}

type RainSettings = {
    desktopDrops: [number, number]
    mobileDrops: [number, number]
    length: [number, number]
    opacity: [number, number]
    speed: [number, number]
    width: [number, number]
}

type GlassDropsSettings = {
    desktopDrops: [number, number]
    mobileDrops: [number, number]
    opacity: [number, number]
    minLife: number
    maxLife: number
    slideSpeed: [number, number]
}

// Switch this to false after visual verification to use the normal subtle rain.
const RAIN_DEBUG_VISIBLE = true

// Set to false to remove the slow "drops on glass" layer.
const GLASS_DROPS_ENABLED = true

// Set to true if the canvas should ever be clipped back to app-main instead of the full viewport.
const RAIN_CLIP_TO_APP_MAIN = false

// Adjust these ranges to make normal or debug rain weaker/stronger.
const RAIN_SETTINGS: Record<'normal' | 'debug', RainSettings> = {
    normal: {
        desktopDrops: [90, 140],
        mobileDrops: [45, 70],
        length: [3, 9],
        opacity: [0.1, 0.2],
        speed: [65, 150],
        width: [0.8, 1.35],
    },
    debug: {
        desktopDrops: [140, 185],
        mobileDrops: [75, 110],
        length: [4, 12],
        opacity: [0.22, 0.4],
        speed: [80, 175],
        width: [1, 1.7],
    },
}

const GLASS_DROPS_SETTINGS: GlassDropsSettings = {
    desktopDrops: [5, 12],
    mobileDrops: [3, 6],
    opacity: [0.08, 0.18],
    minLife: 4,
    maxLife: 8,
    slideSpeed: [3, 10],
}

// Make snow stronger/weaker by changing the flake counts and opacity.
const SNOW_SETTINGS = {
    desktopFlakes: [90, 135] as [number, number],
    mobileFlakes: [45, 70] as [number, number],
    opacity: [0.28, 0.68] as [number, number],
    radius: [0.8, 3.8] as [number, number],
    speed: [13, 43] as [number, number],
    starChance: 0.2,
    crossChance: 0.32,
}

// Make cloudiness stronger/weaker with layerCount, opacity, and blur.
const CLOUD_SETTINGS = {
    layerCount: 4,
    opacity: 0.14,
    blur: 30,
    speed: [32, 52] as [number, number],
}

// Make fog stronger/weaker with layerCount, opacity, and blur.
const FOG_SETTINGS = {
    layerCount: 5,
    opacity: 0.12,
    blur: 20,
    speed: [38, 64] as [number, number],
}

function randomBetween([min, max]: [number, number]) {
    return min + Math.random() * (max - min)
}

function randomInteger([min, max]: [number, number]) {
    return Math.round(randomBetween([min, max]))
}

function createRaindrop(
    width: number,
    height: number,
    startAnywhere: boolean,
    settings: RainSettings,
): Raindrop {
    return {
        x: Math.random() * width,
        y: startAnywhere ? Math.random() * height : -Math.random() * 80,
        length: randomBetween(settings.length),
        speed: randomBetween(settings.speed),
        drift: 5 + Math.random() * 9,
        opacity: randomBetween(settings.opacity),
        width: randomBetween(settings.width),
        shape: Math.random() < 0.42 ? 'bead' : 'trail',
    }
}

function createGlassDrop(
    width: number,
    height: number,
    settings: GlassDropsSettings,
    startAnywhere: boolean,
): GlassDrop {
    const radiusX = 2.4 + Math.random() * 3.8
    const radiusY = radiusX * (1.2 + Math.random() * 0.65)
    const life = randomBetween([settings.minLife, settings.maxLife])

    return {
        x: radiusX + Math.random() * Math.max(1, width - radiusX * 2),
        y: radiusY + Math.random() * Math.max(1, height * 0.78),
        radiusX,
        radiusY,
        trailLength: 8 + Math.random() * 22,
        opacity: randomBetween(settings.opacity),
        age: startAnywhere ? Math.random() * life : 0,
        life,
        slideSpeed: randomBetween(settings.slideSpeed),
        phase: Math.random() * Math.PI * 2,
    }
}

function createSnowflake(
    width: number,
    height: number,
    startAnywhere: boolean,
): Snowflake {
    const shapeRoll = Math.random()
    const shape: Snowflake['shape'] =
        shapeRoll < SNOW_SETTINGS.starChance
            ? 'star'
            : shapeRoll < SNOW_SETTINGS.starChance + SNOW_SETTINGS.crossChance
                ? 'cross'
                : 'dot'

    return {
        x: Math.random() * width,
        y: startAnywhere ? Math.random() * height : -Math.random() * 60,
        radius: randomBetween(SNOW_SETTINGS.radius),
        speed: randomBetween(SNOW_SETTINGS.speed),
        drift: 7 + Math.random() * 18,
        opacity: randomBetween(SNOW_SETTINGS.opacity),
        phase: Math.random() * Math.PI * 2,
        rotation: Math.random() * Math.PI,
        rotationSpeed: -0.35 + Math.random() * 0.7,
        shape,
    }
}

function LiveWeatherBackground({ enabled, condition }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const rainMode = RAIN_DEBUG_VISIBLE ? 'debug' : 'normal'
    const rainSettings = RAIN_SETTINGS[rainMode]
    const glassSettings = GLASS_DROPS_SETTINGS
    const isLowPowerDevice =
        typeof navigator !== 'undefined' &&
        typeof navigator.hardwareConcurrency === 'number' &&
        navigator.hardwareConcurrency <= 2
    const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches

    useEffect(() => {
        const canvas = canvasRef.current
        if (!enabled || isLowPowerDevice || prefersReducedMotion || !canvas) {
            return
        }

        const context = canvas.getContext('2d')
        if (!context) {
            return
        }

        const activeCanvas = canvas
        const activeContext = context
        let animationFrame = 0
        let drops: Raindrop[] = []
        let glassDrops: GlassDrop[] = []
        let snowflakes: Snowflake[] = []
        let viewportWidth = 0
        let viewportHeight = 0
        let lastFrameTime = 0

        function updateCanvasClip() {
            if (!RAIN_CLIP_TO_APP_MAIN) return

            const host = activeCanvas.parentElement
            if (!host) return

            const hostRect = host.getBoundingClientRect()
            const clipTop = Math.max(0, hostRect.top)
            const clipBottom = Math.max(0, window.innerHeight - hostRect.bottom)

            activeCanvas.style.setProperty('--live-weather-clip-top', `${clipTop}px`)
            activeCanvas.style.setProperty('--live-weather-clip-bottom', `${clipBottom}px`)
        }

        function resizeCanvas() {
            const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2)
            viewportWidth = window.innerWidth
            viewportHeight = window.innerHeight

            activeCanvas.width = Math.round(viewportWidth * devicePixelRatio)
            activeCanvas.height = Math.round(viewportHeight * devicePixelRatio)
            activeCanvas.style.width = `${viewportWidth}px`
            activeCanvas.style.height = `${viewportHeight}px`
            activeContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)

            const dropCount = viewportWidth <= 600
                ? randomInteger(rainSettings.mobileDrops)
                : randomInteger(rainSettings.desktopDrops)
            const glassDropCount = viewportWidth <= 600
                ? randomInteger(glassSettings.mobileDrops)
                : randomInteger(glassSettings.desktopDrops)
            const snowflakeCount = viewportWidth <= 600
                ? randomInteger(SNOW_SETTINGS.mobileFlakes)
                : randomInteger(SNOW_SETTINGS.desktopFlakes)

            drops = condition === 'rain'
                ? Array.from(
                    { length: dropCount },
                    () => createRaindrop(viewportWidth, viewportHeight, true, rainSettings),
                )
                : []
            glassDrops = condition === 'rain' && GLASS_DROPS_ENABLED
                ? Array.from(
                    { length: glassDropCount },
                    () => createGlassDrop(
                        viewportWidth,
                        viewportHeight,
                        glassSettings,
                        true,
                    ),
                )
                : []
            snowflakes = condition === 'snow'
                ? Array.from(
                    { length: snowflakeCount },
                    () => createSnowflake(viewportWidth, viewportHeight, true),
                )
                : []
            updateCanvasClip()
        }

        function drawRainDrop(drop: Raindrop) {
            activeContext.save()
            activeContext.lineCap = 'round'
            activeContext.shadowColor = `rgba(120, 190, 225, ${drop.opacity * 0.7})`
            activeContext.shadowBlur = drop.shape === 'bead' ? 3 : 2

            if (drop.shape === 'bead') {
                activeContext.beginPath()
                activeContext.ellipse(
                    drop.x,
                    drop.y,
                    Math.max(0.8, drop.width * 0.72),
                    Math.max(1.3, drop.length * 0.34),
                    -0.12,
                    0,
                    Math.PI * 2,
                )
                activeContext.fillStyle = `rgba(52, 113, 158, ${drop.opacity})`
                activeContext.fill()

                activeContext.beginPath()
                activeContext.moveTo(drop.x + 0.2, drop.y - drop.length * 0.45)
                activeContext.lineTo(drop.x - 0.5, drop.y - drop.length * 0.85)
                activeContext.strokeStyle = `rgba(156, 213, 238, ${drop.opacity * 0.55})`
                activeContext.lineWidth = Math.max(0.5, drop.width * 0.55)
                activeContext.stroke()
            } else {
                activeContext.beginPath()
                activeContext.moveTo(drop.x, drop.y)
                activeContext.quadraticCurveTo(
                    drop.x - drop.length * 0.05,
                    drop.y + drop.length * 0.48,
                    drop.x - drop.length * 0.18,
                    drop.y + drop.length,
                )
                activeContext.strokeStyle = `rgba(50, 109, 153, ${drop.opacity})`
                activeContext.lineWidth = drop.width
                activeContext.stroke()

                activeContext.beginPath()
                activeContext.arc(
                    drop.x,
                    drop.y,
                    Math.max(0.65, drop.width * 0.55),
                    0,
                    Math.PI * 2,
                )
                activeContext.fillStyle = `rgba(200, 234, 247, ${drop.opacity * 0.7})`
                activeContext.fill()
            }

            activeContext.restore()
        }

        function drawGlassDrop(drop: GlassDrop, elapsedSeconds: number) {
            drop.age += elapsedSeconds
            drop.y += drop.slideSpeed * elapsedSeconds
            drop.x += Math.sin(drop.age * 1.3 + drop.phase) * elapsedSeconds * 0.22

            if (drop.age >= drop.life || drop.y > viewportHeight + drop.radiusY) {
                Object.assign(
                    drop,
                    createGlassDrop(viewportWidth, viewportHeight, glassSettings, false),
                )
            }

            const fadeIn = Math.min(1, drop.age / 0.8)
            const fadeOut = Math.min(1, Math.max(0, drop.life - drop.age) / 1.25)
            const alpha = drop.opacity * fadeIn * fadeOut

            activeContext.save()
            activeContext.lineCap = 'round'
            activeContext.shadowColor = `rgba(165, 218, 239, ${alpha * 0.7})`
            activeContext.shadowBlur = 5

            activeContext.beginPath()
            activeContext.moveTo(drop.x, drop.y - drop.radiusY * 0.65)
            activeContext.lineTo(drop.x, drop.y - drop.trailLength)
            activeContext.strokeStyle = `rgba(105, 166, 196, ${alpha * 0.38})`
            activeContext.lineWidth = Math.max(0.8, drop.radiusX * 0.32)
            activeContext.stroke()

            const gradient = activeContext.createRadialGradient(
                drop.x - drop.radiusX * 0.35,
                drop.y - drop.radiusY * 0.4,
                0.5,
                drop.x,
                drop.y,
                drop.radiusY,
            )
            gradient.addColorStop(0, `rgba(245, 253, 255, ${alpha * 0.9})`)
            gradient.addColorStop(0.48, `rgba(155, 207, 229, ${alpha * 0.34})`)
            gradient.addColorStop(1, `rgba(42, 102, 142, ${alpha * 0.72})`)

            activeContext.beginPath()
            activeContext.ellipse(
                drop.x,
                drop.y,
                drop.radiusX,
                drop.radiusY,
                0.04,
                0,
                Math.PI * 2,
            )
            activeContext.fillStyle = gradient
            activeContext.fill()
            activeContext.strokeStyle = `rgba(225, 247, 255, ${alpha * 0.72})`
            activeContext.lineWidth = 0.8
            activeContext.stroke()
            activeContext.restore()
        }

        function drawSnowflake(flake: Snowflake, elapsedSeconds: number) {
            flake.y += flake.speed * elapsedSeconds
            flake.x += Math.sin(flake.y * 0.014 + flake.phase) * flake.drift * elapsedSeconds
            flake.rotation += flake.rotationSpeed * elapsedSeconds

            if (flake.y > viewportHeight + flake.radius || flake.x < -20 || flake.x > viewportWidth + 20) {
                Object.assign(flake, createSnowflake(viewportWidth, viewportHeight, false))
            }

            activeContext.save()
            activeContext.translate(flake.x, flake.y)
            activeContext.rotate(flake.rotation)
            activeContext.lineCap = 'round'
            activeContext.shadowColor = `rgba(218, 239, 255, ${flake.opacity * 0.72})`
            activeContext.shadowBlur = flake.shape === 'dot' ? 3 : 5

            if (flake.shape === 'dot') {
                activeContext.beginPath()
                activeContext.arc(0, 0, Math.max(0.65, flake.radius * 0.58), 0, Math.PI * 2)
                activeContext.fillStyle = `rgba(241, 249, 255, ${flake.opacity})`
                activeContext.fill()
            } else {
                const armCount = flake.shape === 'star' ? 3 : 2
                const armLength = flake.radius * (flake.shape === 'star' ? 1.45 : 1.25)

                activeContext.beginPath()
                for (let arm = 0; arm < armCount; arm += 1) {
                    const angle = (Math.PI / armCount) * arm
                    const dx = Math.cos(angle) * armLength
                    const dy = Math.sin(angle) * armLength
                    activeContext.moveTo(-dx, -dy)
                    activeContext.lineTo(dx, dy)
                }
                activeContext.strokeStyle = `rgba(238, 248, 255, ${flake.opacity})`
                activeContext.lineWidth = Math.max(0.55, flake.radius * 0.32)
                activeContext.stroke()

                activeContext.beginPath()
                activeContext.arc(0, 0, Math.max(0.35, flake.radius * 0.16), 0, Math.PI * 2)
                activeContext.fillStyle = `rgba(255, 255, 255, ${flake.opacity * 0.9})`
                activeContext.fill()
            }
            activeContext.restore()
        }

        function draw(frameTime: number) {
            const elapsedSeconds = lastFrameTime
                ? Math.min((frameTime - lastFrameTime) / 1000, 0.05)
                : 0
            lastFrameTime = frameTime

            activeContext.clearRect(0, 0, viewportWidth, viewportHeight)

            for (const drop of drops) {
                drop.y += drop.speed * elapsedSeconds
                drop.x -= drop.drift * elapsedSeconds

                if (drop.y > viewportHeight + drop.length || drop.x < -drop.length) {
                    Object.assign(
                        drop,
                        createRaindrop(viewportWidth, viewportHeight, false, rainSettings),
                    )
                    drop.x = Math.random() * (viewportWidth + 40)
                }

                drawRainDrop(drop)
            }

            for (const glassDrop of glassDrops) {
                drawGlassDrop(glassDrop, elapsedSeconds)
            }

            for (const snowflake of snowflakes) {
                drawSnowflake(snowflake, elapsedSeconds)
            }

            animationFrame = window.requestAnimationFrame(draw)
        }

        function handleVisibilityChange() {
            if (document.hidden) {
                window.cancelAnimationFrame(animationFrame)
                animationFrame = 0
                return
            }

            if (!animationFrame) {
                lastFrameTime = 0
                animationFrame = window.requestAnimationFrame(draw)
            }
        }

        resizeCanvas()
        animationFrame = window.requestAnimationFrame(draw)
        const scrollContainer = document.getElementById('root')
        window.addEventListener('resize', resizeCanvas)
        if (RAIN_CLIP_TO_APP_MAIN) {
            window.addEventListener('scroll', updateCanvasClip, { passive: true })
            scrollContainer?.addEventListener('scroll', updateCanvasClip, { passive: true })
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            window.cancelAnimationFrame(animationFrame)
            window.removeEventListener('resize', resizeCanvas)
            if (RAIN_CLIP_TO_APP_MAIN) {
                window.removeEventListener('scroll', updateCanvasClip)
                scrollContainer?.removeEventListener('scroll', updateCanvasClip)
            }
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            activeContext.clearRect(0, 0, viewportWidth, viewportHeight)
        }
    }, [condition, enabled, glassSettings, isLowPowerDevice, prefersReducedMotion, rainSettings])

    if (
        !enabled ||
        isLowPowerDevice ||
        prefersReducedMotion ||
        condition === null
    ) {
        return null
    }

    if (condition === 'cloud' || condition === 'fog') {
        const settings = condition === 'cloud' ? CLOUD_SETTINGS : FOG_SETTINGS
        const layers = Array.from({ length: settings.layerCount }, (_, index) => {
            const duration = randomBetween(settings.speed)
            const style = {
                '--weather-layer-index': index,
                '--weather-layer-opacity': settings.opacity,
                '--weather-layer-blur': `${settings.blur}px`,
                '--weather-layer-duration': `${duration}s`,
                '--weather-layer-delay': `${-(duration * index) / settings.layerCount}s`,
                '--weather-layer-scale': 0.9 + index * 0.08,
                '--weather-layer-top': condition === 'cloud'
                    ? `${4 + index * 21}vh`
                    : `${8 + index * 18}vh`,
            } as CSSProperties

            return <span key={index} style={style} />
        })

        return (
            <div
                className={`live-weather-background live-weather-background--${condition}`}
                data-weather-effect={condition}
                aria-hidden="true"
            >
                {layers}
            </div>
        )
    }

    if (condition === 'sun') {
        return (
            <div
                className="live-weather-background live-weather-background--sun"
                data-weather-effect="sun"
                aria-hidden="true"
            />
        )
    }

    return (
        <canvas
            ref={canvasRef}
            className={[
                'live-weather-background',
                `live-weather-background--${rainMode}`,
                RAIN_CLIP_TO_APP_MAIN ? 'live-weather-background--main-only' : '',
            ].filter(Boolean).join(' ')}
            data-rain-mode={rainMode}
            data-glass-drops={condition === 'rain' && GLASS_DROPS_ENABLED ? 'on' : 'off'}
            data-weather-effect={condition}
            aria-hidden="true"
        />
    )
}

export default LiveWeatherBackground
