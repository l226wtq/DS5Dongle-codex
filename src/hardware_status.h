#ifndef DS5_BRIDGE_HARDWARE_STATUS_H
#define DS5_BRIDGE_HARDWARE_STATUS_H

#include <cstdint>

struct __attribute__((packed)) HardwareStatus {
    uint8_t version;
    uint32_t uptime_ms;
    uint32_t sys_clock_khz;
    int16_t temperature_centi_c;
    uint16_t loop_load_permille;
    uint32_t loop_iterations_per_sec;
    uint8_t controller_connected;
    uint8_t speaker_active;
};

void hardware_status_init();
void hardware_status_tick();
HardwareStatus hardware_status_snapshot(bool speaker_active);

#endif //DS5_BRIDGE_HARDWARE_STATUS_H
