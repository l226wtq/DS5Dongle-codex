#include "hardware_status.h"

#include "bt.h"
#include "hardware/adc.h"
#include "hardware/clocks.h"
#include "pico/time.h"

namespace {
constexpr uint8_t STATUS_VERSION = 1;
constexpr float ADC_CONVERSION = 3.3f / 4096.0f;

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
}

HardwareStatus hardware_status_snapshot(bool speaker_active) {
    return HardwareStatus{
        .version = STATUS_VERSION,
        .uptime_ms = to_ms_since_boot(get_absolute_time()),
        .sys_clock_khz = clock_get_hz(clk_sys) / 1000,
        .temperature_centi_c = read_temperature_centi_c(),
        .controller_connected = static_cast<uint8_t>(bt_is_controller_connected()),
        .speaker_active = static_cast<uint8_t>(speaker_active),
    };
}
