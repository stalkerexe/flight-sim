import { Aircraft } from '@/aircraft/Aircraft';
import { FloatingOrigin } from '@/core/FloatingOrigin';

/**
 * Управляет приборной панелью (index.html → #instrument-panel): авиагоризонт
 * на SVG (тангаж/крен), цифровые показания (скорость/высота/вертикальная
 * скорость/курс/угол атаки), индикатор срыва потока, вертикальный индикатор газа.
 *
 * Работает напрямую с DOM (querySelector + textContent/transform), а не через
 * фреймворк — панель простая и обновляется каждый кадр, лишний слой
 * реактивности здесь не нужен и только добавил бы накладные расходы.
 *
 * Авиагоризонт: SVG-группа #horizon-group (небо/земля/линия горизонта)
 * поворачивается на -крен вокруг центра гейджа и сдвигается вертикально
 * пропорционально тангажу — стандартный визуальный приём для
 * непрофессиональных (не реальных авиационных) авиагоризонтов.
 */
export class InstrumentPanel {
  private readonly horizonGroup: SVGGElement | null;
  private readonly throttleFill: HTMLElement | null;
  private readonly stallIndicator: HTMLElement | null;
  private readonly readoutSpeed: HTMLElement | null;
  private readonly readoutAltitude: HTMLElement | null;
  private readonly readoutVSpeed: HTMLElement | null;
  private readonly readoutHeading: HTMLElement | null;
  private readonly readoutAoa: HTMLElement | null;

  /** Пикселей сдвига авиагоризонта на градус тангажа. */
  private static readonly PITCH_PX_PER_DEG = 2.4;

  constructor() {
    this.horizonGroup = document.getElementById('horizon-group') as SVGGElement | null;
    this.throttleFill = document.getElementById('throttle-fill');
    this.stallIndicator = document.getElementById('readout-stall');
    this.readoutSpeed = document.getElementById('readout-speed');
    this.readoutAltitude = document.getElementById('readout-altitude');
    this.readoutVSpeed = document.getElementById('readout-vspeed');
    this.readoutHeading = document.getElementById('readout-heading');
    this.readoutAoa = document.getElementById('readout-aoa');
  }

  update(aircraft: Aircraft, floatingOrigin: FloatingOrigin): void {
    if (this.horizonGroup) {
      const pitchPx = aircraft.pitchDeg * InstrumentPanel.PITCH_PX_PER_DEG;
      this.horizonGroup.setAttribute(
        'transform',
        `rotate(${-aircraft.rollDeg} 100 100) translate(0 ${pitchPx})`,
      );
    }

    if (this.throttleFill) {
      this.throttleFill.style.height = `${Math.round(aircraft.throttle * 100)}%`;
    }

    if (this.stallIndicator) {
      this.stallIndicator.style.visibility = aircraft.stalled ? 'visible' : 'hidden';
    }

    // Берём мировую позицию через FloatingOrigin, а не group.position.y —
    // иначе при смене чанков высота может сбрасываться в 0.
    const worldPos = floatingOrigin.getWorldPosition(aircraft.group);
    const altitudeAgl = worldPos.y - aircraft.lastGroundHeight;

    if (this.readoutSpeed) this.readoutSpeed.textContent = (aircraft.speed * 3.6).toFixed(0);
    if (this.readoutAltitude) this.readoutAltitude.textContent = Math.max(0, altitudeAgl).toFixed(0);
    if (this.readoutVSpeed) this.readoutVSpeed.textContent = aircraft.verticalSpeed.toFixed(1);
    if (this.readoutHeading) this.readoutHeading.textContent = aircraft.headingDeg.toFixed(0);
    if (this.readoutAoa) this.readoutAoa.textContent = aircraft.angleOfAttackDeg.toFixed(1);
  }
}
