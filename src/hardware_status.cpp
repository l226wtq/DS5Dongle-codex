#include "hardware_status.h"

#include <algorithm>

#include "bt.h"
#include "hardware/adc.h"
#include "hardware/clocks.h"
#include "pico/time.h"

namespace {
constexpr uint8_t STATUS_VERSION = 1;
constexpr uint32_t SAMPLE_INTERVAL_US = 1'000'000;
constexpr float ADC_CONVERSION = 3.3f / 4096.0f;

uint32_t loop_count = 0;
uint32_t last_sample_us = 0;
uint32_t loop_iterations_per_sec = 0;
uint32_t max_loop_iterations_per_mhz = 0;
uint16_t loop_load_permille = 0;

int16_t read_temperature_centi_c() {
    adc_select_input(ADC_TEMPERATURE_CHANNEL_NUM);
    const uint16_t raw = adc_read();
    const float voltage = static_cast<float>(raw) * ADC_CONVERSION;
    const float temperature_c = 27.0f - (voltage - 0.706f) / 0.001721f;
    return static_cast<int16_t>(temperature_c * 100.0f);
}
}

void hardware_status_init() {
    adc_init();
    adc_set_temp_sensor_enabled(true);
    last_sample_us = time_us_32();
}

void hardware_status_tick() {
    loop_count++;
    const uint32_t now = time_us_32();
    const uint32_t elapsed = now - last_sample_us;
    if (elapsed < SAMPLE_INTERVAL_US) {
        return;
    }

    loop_iterations_per_sec = static_cast<uint32_t>(
        (static_cast<uint64_t>(loop_count) * SAMPLE_INTERVAL_US) / elapsed);
    const uint32_t sys_clock_khz = clock_get_hz(clk_sys) / 1000;
    const uint32_t loop_iterations_per_mhz = sys_clock_khz > 0
                                                 ? static_cast<uint32_t>(
                                                     (static_cast<uint64_t>(loop_iterations_per_sec) * 1000) /
                                                     sys_clock_khz)
                                                 : 0;
    max_loop_iterations_per_mhz = std::max(max_loop_iterations_per_mhz, loop_iterations_per_mhz);
    if (max_loop_iterations_per_mhz > 0) {
        const auto headroom_permille =
            static_cast<uint32_t>((static_cast<uint64_t>(loop_iterations_per_mhz) * 1000) /
                                  max_loop_iterations_per_mhz);
        loop_load_permille = static_cast<uint16_t>(headroom_permille >= 1000 ? 0 : 1000 - headroom_permille);
    }

    loop_count = 0;
    last_sample_us = now;
}

HardwareStatus hardware_status_snapshot(bool speaker_active) {
    return HardwareStatus{
        .version = STATUS_VERSION,
        .uptime_ms = to_ms_since_boot(get_absolute_time()),
        .sys_clock_khz = clock_get_hz(clk_sys) / 1000,
        .temperature_centi_c = read_temperature_centi_c(),
        .loop_load_permille = loop_load_permille,
        .loop_iterations_per_sec = loop_iterations_per_sec,
        .controller_connected = static_cast<uint8_t>(bt_is_controller_connected()),
        .speaker_active = static_cast<uint8_t>(speaker_active),
    };
}
