export type LiveWeatherCondition = 'rain' | 'snow' | 'sun' | 'cloud' | 'fog'

// Before production return this to false.
export const LIVE_WEATHER_DEV_MODE = false

// Change this value to test rain, snow, sun, cloud, or fog locally.
export const LIVE_WEATHER_DEV_CONDITION: LiveWeatherCondition = 'fog'

export const LIVE_WEATHER_DEV_ACTIVE =
    import.meta.env.DEV && LIVE_WEATHER_DEV_MODE

const LIVE_WEATHER_DEV_DATA: Record<
    LiveWeatherCondition,
    { temperature: number; weatherCode: number }
> = {
    snow: { temperature: -2, weatherCode: 71 },
    rain: { temperature: 15, weatherCode: 61 },
    sun: { temperature: 25, weatherCode: 0 },
    cloud: { temperature: 18, weatherCode: 3 },
    fog: { temperature: 8, weatherCode: 45 },
}

export function getLiveWeatherDevData() {
    return {
        ...LIVE_WEATHER_DEV_DATA[LIVE_WEATHER_DEV_CONDITION],
        timestamp: Date.now(),
    }
}

export function getLiveWeatherCondition(
    weatherCode: number | null,
): LiveWeatherCondition | null {
    if (weatherCode === null) return null
    if ([45, 48].includes(weatherCode)) return 'fog'
    if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return 'snow'
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(weatherCode)) {
        return 'rain'
    }
    if (weatherCode === 0) return 'sun'
    if ([1, 2, 3].includes(weatherCode)) return 'cloud'
    return null
}
