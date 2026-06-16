type Props = {
    enabled: boolean
    temperature: number | null
    weatherCode: number | null
    onToggle: () => void
}

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
const FOG_CODES = new Set([45, 48])

function getWeatherIcon(weatherCode: number | null) {
    if (weatherCode === null) return null
    if (FOG_CODES.has(weatherCode)) return '🌫️'
    if (RAIN_CODES.has(weatherCode)) return '🌧️'
    if (SNOW_CODES.has(weatherCode)) return '❄️'
    if (weatherCode === 0) return '☀️'
    if (weatherCode >= 1 && weatherCode <= 3) return '☁️'
    return null
}

function LiveWeatherToggle({ enabled, temperature, weatherCode, onToggle }: Props) {
    const weatherIcon = temperature === null ? null : getWeatherIcon(weatherCode)
    const temperatureLabel = temperature === null ? null : `${Math.round(temperature)}°C`
    const statusLabel = [
        'LIVE weather background',
        enabled ? 'on' : 'off',
        temperatureLabel,
    ].filter(Boolean).join(', ')

    return (
        <button
            type="button"
            className={`live-weather-toggle${enabled ? ' live-weather-toggle--active' : ''}`}
            onClick={onToggle}
            aria-pressed={enabled}
            aria-label={statusLabel}
            title={statusLabel}
        >
            <span className="live-weather-toggle__dot" aria-hidden="true" />
            {weatherIcon && (
                <span className="live-weather-toggle__icon" aria-hidden="true">
                    {weatherIcon}
                </span>
            )}
            <span>LIVE</span>
            {temperatureLabel && (
                <span className="live-weather-toggle__temperature">
                    · {temperatureLabel}
                </span>
            )}
        </button>
    )
}

export default LiveWeatherToggle
