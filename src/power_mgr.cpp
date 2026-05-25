#include "power_mgr.h"

#include <cstdio>

#include "hardware/clocks.h"
#include "hardware/vreg.h"
#include "pico/time.h"

#ifndef IDLE_SYS_CLOCK_KHZ
#define IDLE_SYS_CLOCK_KHZ 125000
#endif

namespace {
bool running_fast = false;

bool set_clock_khz(const uint32_t khz) {
    if (!set_sys_clock_khz(khz, true)) {
        printf("[Power] Failed to set system clock to %lu kHz\n", static_cast<unsigned long>(khz));
        return false;
    }
    printf("[Power] System clock set to %lu kHz\n", static_cast<unsigned long>(khz));
    return true;
}

void set_fast_clock(void) {
    if (running_fast) {
        return;
    }
    vreg_set_voltage(VREG_VOLTAGE_1_20);
    sleep_ms(10);
    if (!set_clock_khz(SYS_CLOCK_KHZ)) {
        return;
    }
    running_fast = true;
}

void set_idle_clock(void) {
    if (!running_fast) {
        return;
    }
    if (!set_clock_khz(IDLE_SYS_CLOCK_KHZ)) {
        return;
    }
    vreg_set_voltage(VREG_VOLTAGE_DEFAULT);
    sleep_ms(10);
    running_fast = false;
}
}

void power_clock_init(void) {
    set_fast_clock();
}

void power_clock_on_controller_connected(void) {
    set_fast_clock();
}

void power_clock_on_controller_disconnected(void) {
    set_idle_clock();
}
