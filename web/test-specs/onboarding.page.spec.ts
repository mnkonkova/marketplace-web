import { RolePickerComponent } from '@shared/ui/role-picker/role-picker.component';
import { SkillPickerComponent } from '@shared/ui/skill-picker/skill-picker.component';
import { AvatarPickerComponent } from '@shared/ui/avatar-picker/avatar-picker.component';
import { TestBed } from '@angular/core/testing';

import { Category } from '@entities/category/model/category.types';

const CATS: Category[] = [
  { code: 'editing', title: 'Монтажёр', description: 'Монтаж', type: 'Производство' } as Category,
  { code: 'smm', title: 'SMM', description: 'Соцсети', type: 'Продвижение' } as Category,
];

// Онбординг и кабинет собирают одни и те же данные, поэтому выбор ролей,
// чипы навыков и аватар вынесены в общие компоненты. Тесты держат их
// контракт: сломается он — сломаются оба места сразу.
describe('RolePickerComponent', () => {
  function setup(selected: string[], primary: string) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(RolePickerComponent);
    fixture.componentRef.setInput('categories', CATS);
    fixture.componentRef.setInput('selectedCategories', new Set(selected));
    fixture.componentRef.setInput('primaryCategory', primary);
    fixture.detectChanges();
    return fixture;
  }

  it('показывает название главной роли', () => {
    expect(setup(['editing'], 'editing').componentInstance.primaryTitle()).toBe('Монтажёр');
  });

  it('главная роль не считается, если её сняли из выбранных', () => {
    expect(setup(['smm'], 'editing').componentInstance.primaryTitle()).toBe('');
  });

  it('считает роли сверх трёх видимых', () => {
    const f = setup(['a', 'b', 'c', 'd', 'e'], 'a');
    expect(f.componentInstance.hiddenRolesCount()).toBe(2);
    expect(setup(['a'], 'a').componentInstance.hiddenRolesCount()).toBe(0);
  });

  it('нажатие «сделать главной» не всплывает до карточки', () => {
    const f = setup(['editing'], '');
    const ev = new MouseEvent('click');
    spyOn(ev, 'stopPropagation');
    f.componentInstance.onSetPrimary('editing', ev);
    expect(ev.stopPropagation).toHaveBeenCalled();
  });
});

describe('AvatarPickerComponent', () => {
  function setup(name: string) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(AvatarPickerComponent);
    fixture.componentRef.setInput('name', name);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('инициалы — по первым буквам имени и фамилии', () => {
    expect(setup('Мария Конькова').initials()).toBe('МК');
    expect(setup('Мария').initials()).toBe('М');
    expect(setup('  ').initials()).toBe('?');
  });

  it('у каждого аватара свой id поля — их может быть два на странице', () => {
    const a = setup('А');
    const b = setup('Б');
    expect(a.inputId).not.toBe(b.inputId);
  });
});

describe('SkillPickerComponent', () => {
  it('создаётся без данных и ничего не выбирает сам', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(SkillPickerComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedSkills().size).toBe(0);
  });
});
