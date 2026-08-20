import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ProfileForm, emptyProfileForm } from '@entities/me/model/profile-form';
import { ProfileBasicComponent } from '@features/profile-basic/profile-basic.component';

function setup(form: ProfileForm): ComponentFixture<ProfileBasicComponent> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    // nz-select анимирован — без noop-аниматора рендер падает.
    providers: [provideNoopAnimations()],
  });
  const fixture = TestBed.createComponent(ProfileBasicComponent);
  fixture.componentRef.setInput('form', form);
  fixture.detectChanges();
  return fixture;
}

function text(fixture: ComponentFixture<ProfileBasicComponent>, selector: string): string {
  return (fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent?.trim() ?? '';
}

describe('ProfileBasicComponent — вкладка «Основное»', () => {
  it('поля рендерятся из формы страницы (ngModel пишет в тот же объект)', async () => {
    const form = { ...emptyProfileForm(), display_name: 'Аня', city: 'Тверь' };
    const fixture = setup(form);
    // ngModel переносит значение в DOM микротаском — ждём стабилизации.
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const inputs = Array.from(el.querySelectorAll('input')).map((i) => i.value);
    expect(inputs).toContain('Аня');
    expect(inputs).toContain('Тверь');
  });

  it('пустая цена показывает «по договорённости», а не «от 0 ₽»', () => {
    const fixture = setup({ ...emptyProfileForm(), rate_min: 0, rate_max: null });
    expect(text(fixture, '.rate-preview')).toBe('по договорённости');
    expect(text(fixture, '.warn')).toContain('Ноль');
  });

  it('перевёрнутый диапазон подсвечивается ошибкой прямо в форме', () => {
    const fixture = setup({ ...emptyProfileForm(), rate_min: 90000, rate_max: 30000 });
    expect(text(fixture, '.err')).toBe('Ставка «от» больше, чем «до».');
  });

  it('превью «о себе» показывает список из строк с галочками', () => {
    const fixture = setup({ ...emptyProfileForm(), bio: '✅ Монтаж\n✅ Цвет' });
    fixture.componentInstance.bioPreview.set(true);
    fixture.detectChanges();
    const items = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.bio-preview li'),
    ).map((li) => li.textContent?.trim());
    expect(items).toEqual(['Монтаж', 'Цвет']);
  });
});
