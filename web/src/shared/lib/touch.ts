/**
 * Тач-экран определяем один раз при создании компонента: на телефоне списки
 * открываются нижней шторкой, а выпадающие меню ng-zorro у края экрана
 * прижимаются к границе и половина пунктов уезжает под палец.
 *
 * Проверяем именно (hover: none) и (pointer: coarse), а не ширину: у
 * ноутбуков с тачскрином ширина десктопная, но hover есть — им шторка не
 * нужна.
 */
export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches
  );
}
