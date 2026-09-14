import {
  CrmNavItem,
  crmNavGroups,
  crmNavItemActive,
  crmNavLocate,
  crmRootLabel,
} from '@widgets/crm-layout/crm-nav';

/**
 * Состав сайдбара CRM.
 *
 * Оболочка теперь одна на админа и менеджера, и единственное, что их
 * различает, — этот список. Утверждение «менеджер не видит админских
 * разделов» раньше держалось на том, что у ролей были разные лейауты;
 * теперь оно держится здесь, и проверять его надо здесь же.
 */

function links(role: 'admin' | 'manager'): string[] {
  return crmNavGroups(role).flatMap((g) => g.items.map((i) => i.link));
}

function labels(role: 'admin' | 'manager'): string[] {
  return crmNavGroups(role).flatMap((g) => g.items.map((i) => i.label));
}

describe('crmNavGroups', () => {
  it('у менеджера только его работа — админских разделов нет ни одного', () => {
    expect(labels('manager')).toEqual(['Входящие', 'Мои проекты']);
    expect(links('manager')).toEqual(['/manager', '/manager/projects']);
    for (const link of links('manager')) {
      expect(link.startsWith('/admin')).withContext(link).toBeFalse();
    }
  });

  it('у админа — четыре группы по поводам зайти', () => {
    expect(crmNavGroups('admin').map((g) => g.title)).toEqual([
      'Работа',
      'Люди',
      'Креаторы',
      'Продакшн',
    ]);
  });

  it('админские разделы стоят по тем адресам, которые открываются', () => {
    expect(links('admin')).toEqual([
      '/admin',
      '/admin/projects',
      '/admin/moderation',
      '/admin/team',
      '/admin/specialists',
      '/admin/clients',
      '/admin/tariff',
      '/admin/checklists',
      '/admin/pipelines',
      '/admin/productions',
    ]);
  });

  it('канбан не занимает отдельный пункт: это вид раздела «Проекты»', () => {
    expect(links('admin')).not.toContain('/admin/board');
    expect(links('manager')).not.toContain('/manager/board');
  });

  it('очередь на нас помечена бейджем, и таких пунктов ровно два', () => {
    const badged = [...crmNavGroups('admin'), ...crmNavGroups('manager')]
      .flatMap((g) => g.items)
      .filter((i) => i.counter);
    expect(badged.map((i) => i.label)).toEqual(['Модерация', 'Входящие']);
  });
});

describe('crmNavItemActive', () => {
  const projects: CrmNavItem = {
    label: 'Проекты',
    link: '/admin/projects',
    icon: 'folder',
    also: ['/manager/projects'],
  };
  const summary: CrmNavItem = { label: 'Сводка', link: '/admin', icon: 'home', exact: true };

  it('вид списка подсветку не меняет — это тот же раздел', () => {
    expect(crmNavItemActive(projects, '/admin/projects?view=board')).toBeTrue();
    expect(crmNavItemActive(projects, '/admin/projects?status=active&page=3')).toBeTrue();
  });

  // Открыв проект, админ не должен терять, где он находится: карточка
  // живёт по менеджерскому адресу, но раздел у неё тот же.
  it('карточка проекта по менеджерскому адресу горит разделом «Проекты»', () => {
    expect(crmNavItemActive(projects, '/manager/projects/abc-123')).toBeTrue();
  });

  it('корень раздела горит только на самом себе', () => {
    expect(crmNavItemActive(summary, '/admin')).toBeTrue();
    expect(crmNavItemActive(summary, '/admin/projects')).toBeFalse();
    expect(crmNavItemActive(summary, '/admin/team')).toBeFalse();
  });

  it('соседний раздел с общим началом не загорается', () => {
    const pipelines: CrmNavItem = { label: 'Воронки', link: '/admin/pipelines', icon: 'flow' };
    expect(crmNavItemActive(pipelines, '/admin/pipelines/abc')).toBeTrue();
    expect(crmNavItemActive(pipelines, '/admin/pipelines-old')).toBeFalse();
  });
});

describe('crmNavLocate', () => {
  it('путь собирается из того же дерева, что рисует сайдбар', () => {
    const here = crmNavLocate('admin', '/admin/tariff');
    expect(here?.group.title).toBe('Креаторы');
    expect(here?.item.label).toBe('Прайс');
    expect(crmRootLabel('admin')).toBe('Админка');
  });

  it('раздела нет в дереве — путь не выдумывается', () => {
    expect(crmNavLocate('admin', '/admin/users')).toBeNull();
    // Менеджеру админский адрес не принадлежит, даже если он на него зашёл.
    expect(crmNavLocate('manager', '/admin/tariff')).toBeNull();
  });
});
