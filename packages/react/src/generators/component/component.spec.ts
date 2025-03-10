import { installedCypressVersion } from '@nx/cypress/src/utils/cypress-version';
import {
  logger,
  readJson,
  readProjectConfiguration,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { createApp, createLib } from '../../utils/testing-generators';
import { componentGenerator } from './component';

// need to mock cypress otherwise it'll use the nx installed version from package.json
//  which is v9 while we are testing for the new v10 version
jest.mock('@nx/cypress/src/utils/cypress-version');

describe('component', () => {
  let appTree: Tree;
  let projectName: string;
  let mockedInstalledCypressVersion: jest.Mock<
    ReturnType<typeof installedCypressVersion>
  > = installedCypressVersion as never;

  beforeEach(async () => {
    mockedInstalledCypressVersion.mockReturnValue(10);
    projectName = 'my-lib';
    appTree = createTreeWithEmptyWorkspace();
    await createApp(appTree, 'my-app');
    await createLib(appTree, projectName);
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should generate files', async () => {
    await componentGenerator(appTree, {
      name: 'hello',
      style: 'css',
      project: projectName,
    });

    expect(appTree.exists('my-lib/src/lib/hello/hello.tsx')).toBeTruthy();
    expect(appTree.exists('my-lib/src/lib/hello/hello.spec.tsx')).toBeTruthy();
    expect(
      appTree.exists('my-lib/src/lib/hello/hello.module.css')
    ).toBeTruthy();
    expect(appTree.read('my-lib/src/lib/hello/hello.tsx').toString()).toMatch(
      /import styles from '.\/hello.module.css'/
    );
    expect(appTree.read('my-lib/src/lib/hello/hello.tsx').toString()).toMatch(
      /<div className={styles\['container']}>/
    );
  });

  it('should generate files with global CSS', async () => {
    await componentGenerator(appTree, {
      name: 'hello',
      style: 'css',
      project: projectName,
      globalCss: true,
    });

    expect(appTree.exists('my-lib/src/lib/hello/hello.tsx')).toBeTruthy();
    expect(appTree.exists('my-lib/src/lib/hello/hello.spec.tsx')).toBeTruthy();
    expect(appTree.exists('my-lib/src/lib/hello/hello.css')).toBeTruthy();
    expect(appTree.exists('my-lib/src/lib/hello/hello.module.css')).toBeFalsy();
    expect(appTree.read('my-lib/src/lib/hello/hello.tsx').toString()).toMatch(
      /import '.\/hello.css'/
    );
    expect(appTree.read('my-lib/src/lib/hello/hello.tsx').toString()).toMatch(
      /<div>/
    );
  });

  it('should generate files for an app', async () => {
    await componentGenerator(appTree, {
      name: 'hello',
      style: 'css',
      project: 'my-app',
    });

    expect(appTree.exists('my-app/src/app/hello/hello.tsx')).toBeTruthy();
    expect(appTree.exists('my-app/src/app/hello/hello.spec.tsx')).toBeTruthy();
    expect(
      appTree.exists('my-app/src/app/hello/hello.module.css')
    ).toBeTruthy();
  });

  it('should generate files for an app with global CSS', async () => {
    await componentGenerator(appTree, {
      name: 'hello',
      style: 'css',
      project: 'my-app',
      globalCss: true,
    });

    expect(appTree.exists('my-app/src/app/hello/hello.tsx')).toBeTruthy();
    expect(appTree.exists('my-app/src/app/hello/hello.spec.tsx')).toBeTruthy();
    expect(appTree.exists('my-app/src/app/hello/hello.css')).toBeTruthy();
    expect(appTree.exists('my-app/src/app/hello/hello.module.css')).toBeFalsy();
  });

  describe('--classComponent', () => {
    it('should add the override keyword to the render() method', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        style: 'css',
        project: projectName,
        classComponent: true,
      });

      const tsxFileContent = appTree.read(
        `my-lib/src/lib/hello/hello.tsx/`,
        'utf-8'
      );
      expect(tsxFileContent).toMatch(/override\srender\(\)/);
    });
  });

  describe('--export', () => {
    it('should add to index.ts barrel', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        style: 'css',
        project: projectName,
        export: true,
      });

      const indexContent = appTree.read('my-lib/src/index.ts', 'utf-8');

      expect(indexContent).toMatch(/lib\/hello/);
    });

    it('should not export from an app', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        style: 'css',
        project: 'my-app',
        export: true,
      });

      const indexContent = appTree.read('my-lib/src/index.ts', 'utf-8');

      expect(indexContent).not.toMatch(/lib\/hello/);
    });

    it('should work for projects without sourceRoot', async () => {
      const projectConfig = readProjectConfiguration(appTree, 'my-lib');
      delete projectConfig.sourceRoot;
      updateProjectConfiguration(appTree, 'my-lib', projectConfig);

      await componentGenerator(appTree, {
        name: 'my-lib/src/lib/hello',
        style: 'css',
        export: true,
      });

      const indexContent = appTree.read('my-lib/src/index.ts', 'utf-8');

      expect(indexContent).not.toMatch(/lib\/hello/);
    });
  });

  describe('--pascalCaseFiles', () => {
    it('should generate component files with upper case names', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        style: 'css',
        project: projectName,
        pascalCaseFiles: true,
      });
      expect(appTree.exists('my-lib/src/lib/hello/Hello.tsx')).toBeTruthy();
      expect(
        appTree.exists('my-lib/src/lib/hello/Hello.spec.tsx')
      ).toBeTruthy();
      expect(
        appTree.exists('my-lib/src/lib/hello/Hello.module.css')
      ).toBeTruthy();
    });
  });

  describe('--pascalCaseDirectory', () => {
    it('should generate component files with pascal case directories', async () => {
      await componentGenerator(appTree, {
        name: 'hello-world',
        style: 'css',
        project: projectName,
        pascalCaseFiles: true,
        pascalCaseDirectory: true,
      });
      expect(
        appTree.exists('my-lib/src/lib/HelloWorld/HelloWorld.tsx')
      ).toBeTruthy();
      expect(
        appTree.exists('my-lib/src/lib/HelloWorld/HelloWorld.spec.tsx')
      ).toBeTruthy();
      expect(
        appTree.exists('my-lib/src/lib/HelloWorld/HelloWorld.module.css')
      ).toBeTruthy();
    });
  });

  describe('--style none', () => {
    it('should generate component files without styles', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        project: projectName,
        style: 'none',
      });
      expect(appTree.exists('my-lib/src/lib/hello/hello.tsx')).toBeTruthy();
      expect(
        appTree.exists('my-lib/src/lib/hello/hello.spec.tsx')
      ).toBeTruthy();
      expect(appTree.exists('my-lib/src/lib/hello/hello.css')).toBeFalsy();
      expect(appTree.exists('my-lib/src/lib/hello/hello.scss')).toBeFalsy();
      expect(
        appTree.exists('my-lib/src/lib/hello/hello.module.css')
      ).toBeFalsy();
      expect(
        appTree.exists('my-lib/src/lib/hello/hello.module.scss')
      ).toBeFalsy();

      const content = appTree.read('my-lib/src/lib/hello/hello.tsx').toString();
      expect(content).not.toContain('styled-components');
      expect(content).not.toContain('<StyledHello>');
      expect(content).not.toContain('@emotion/styled');
      expect(content).not.toContain('<StyledHello>');

      //for imports
      expect(content).not.toContain('hello.css');
      expect(content).not.toContain('hello.scss');
      expect(content).not.toContain('hello.module.css');
      expect(content).not.toContain('hello.module.scss');
    });
  });

  describe('--style styled-components', () => {
    it('should use styled-components as the styled API library', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        project: projectName,
        style: 'styled-components',
      });

      expect(
        appTree.exists('my-lib/src/lib/hello/hello.styled-components')
      ).toBeFalsy();
      expect(appTree.exists('my-lib/src/lib/hello/hello.tsx')).toBeTruthy();

      const content = appTree.read('my-lib/src/lib/hello/hello.tsx').toString();
      expect(content).toContain('styled-components');
      expect(content).toContain('<StyledHello>');
    });

    it('should add dependencies to package.json', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        project: projectName,
        style: 'styled-components',
      });

      const packageJSON = readJson(appTree, 'package.json');
      expect(packageJSON.dependencies['styled-components']).toBeDefined();
    });
  });

  describe('--style @emotion/styled', () => {
    it('should use @emotion/styled as the styled API library', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        project: projectName,
        style: '@emotion/styled',
      });

      expect(
        appTree.exists('my-lib/src/lib/hello/hello.@emotion/styled')
      ).toBeFalsy();
      expect(appTree.exists('my-lib/src/lib/hello/hello.tsx')).toBeTruthy();

      const content = appTree.read('my-lib/src/lib/hello/hello.tsx').toString();
      expect(content).toContain('@emotion/styled');
      expect(content).toContain('<StyledHello>');
    });

    it('should add dependencies to package.json', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        project: projectName,
        style: '@emotion/styled',
      });

      const packageJSON = readJson(appTree, 'package.json');
      expect(packageJSON.dependencies['@emotion/styled']).toBeDefined();
      expect(packageJSON.dependencies['@emotion/react']).toBeDefined();
    });
  });

  describe('--style styled-jsx', () => {
    it('should use styled-jsx as the styled API library', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        project: projectName,
        style: 'styled-jsx',
      });

      expect(
        appTree.exists('my-lib/src/lib/hello/hello.styled-jsx')
      ).toBeFalsy();
      expect(appTree.exists('my-lib/src/lib/hello/hello.tsx')).toBeTruthy();

      const content = appTree.read('my-lib/src/lib/hello/hello.tsx').toString();
      expect(content).toContain('<style jsx>');
      expect(content).not.toContain("styles['container']");
    });

    it('should add dependencies to package.json', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        project: projectName,
        style: 'styled-jsx',
      });

      const packageJSON = readJson(appTree, 'package.json');
      expect(packageJSON.dependencies['styled-jsx']).toBeDefined();
    });
  });

  describe('--routing', () => {
    it('should add routes to the component', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        style: 'css',
        project: projectName,
        routing: true,
      });

      const content = appTree.read('my-lib/src/lib/hello/hello.tsx').toString();
      expect(content).toContain('react-router-dom');
      expect(content).toMatch(/<Route\s*path="\/"/);
      expect(content).toMatch(/<Link\s*to="\/"/);

      const packageJSON = readJson(appTree, 'package.json');
      expect(packageJSON.dependencies['react-router-dom']).toBeDefined();
    });
  });

  describe('--directory', () => {
    it('should create component under the directory', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        style: 'css',
        project: projectName,
        directory: 'components',
      });

      expect(appTree.exists('/my-lib/src/components/hello/hello.tsx'));
    });

    it('should create with nested directories', async () => {
      await componentGenerator(appTree, {
        name: 'helloWorld',
        style: 'css',
        project: projectName,
        directory: 'lib/foo',
      });

      expect(appTree.exists('/my-lib/src/lib/foo/hello-world/hello-world.tsx'));
    });
  });

  describe('--flat', () => {
    it('should create in project directory rather than in its own folder', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        style: 'css',
        project: projectName,
        flat: true,
      });

      expect(appTree.exists('/my-lib/src/lib/hello.tsx'));
    });
    it('should work with custom directory path', async () => {
      await componentGenerator(appTree, {
        name: 'hello',
        style: 'css',
        project: projectName,
        flat: true,
        directory: 'components',
      });

      expect(appTree.exists('/my-lib/src/components/hello.tsx'));
    });
  });
});
