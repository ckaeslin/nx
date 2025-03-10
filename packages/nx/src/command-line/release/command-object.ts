import { Argv, CommandModule, showHelp } from 'yargs';
import { readNxJson } from '../../project-graph/file-utils';
import {
  OutputStyle,
  RunManyOptions,
  parseCSV,
  withOutputStyleOption,
  withOverrides,
  withRunManyOptions,
} from '../yargs-utils/shared-options';
import { VersionData } from './utils/shared';

export interface NxReleaseArgs {
  groups?: string[];
  projects?: string[];
  dryRun?: boolean;
  verbose?: boolean;
}

interface GitCommitAndTagOptions {
  gitCommit?: boolean;
  gitCommitMessage?: string;
  gitCommitArgs?: string;
  gitTag?: boolean;
  gitTagMessage?: string;
  gitTagArgs?: string;
}

export type VersionOptions = NxReleaseArgs &
  GitCommitAndTagOptions & {
    specifier?: string;
    preid?: string;
    stageChanges?: boolean;
  };

export type ChangelogOptions = NxReleaseArgs &
  GitCommitAndTagOptions & {
    // version and/or versionData must be set
    version?: string | null;
    versionData?: VersionData;
    to?: string;
    from?: string;
    interactive?: string;
    gitRemote?: string;
  };

export type PublishOptions = NxReleaseArgs &
  Partial<RunManyOptions> & { outputStyle?: OutputStyle } & {
    registry?: string;
    tag?: string;
    otp?: number;
  };

export const yargsReleaseCommand: CommandModule<
  Record<string, unknown>,
  NxReleaseArgs
> = {
  command: 'release',
  describe:
    '**ALPHA**: Orchestrate versioning and publishing of applications and libraries',
  builder: (yargs) =>
    yargs
      .command(versionCommand)
      .command(changelogCommand)
      .command(publishCommand)
      .demandCommand()
      // Error on typos/mistyped CLI args, there is no reason to support arbitrary unknown args for these commands
      .strictOptions()
      .option('groups', {
        description:
          'One or more release groups to target with the current command.',
        type: 'string',
        coerce: parseCSV,
        alias: ['group', 'g'],
      })
      .option('projects', {
        type: 'string',
        alias: 'p',
        coerce: parseCSV,
        describe:
          'Projects to run. (comma/space delimited project names and/or patterns)',
      })
      .option('dryRun', {
        describe:
          'Preview the changes without updating files/creating releases',
        alias: 'd',
        type: 'boolean',
        default: false,
      })
      .option('verbose', {
        type: 'boolean',
        describe:
          'Prints additional information about the commands (e.g., stack traces)',
      })
      .check((argv) => {
        if (argv.groups && argv.projects) {
          throw new Error(
            'The --projects and --groups options are mutually exclusive, please use one or the other.'
          );
        }
        const nxJson = readNxJson();
        if (argv.groups?.length) {
          for (const group of argv.groups) {
            if (!nxJson.release?.groups?.[group]) {
              throw new Error(
                `The specified release group "${group}" was not found in nx.json`
              );
            }
          }
        }
        return true;
      }) as any, // the type: 'string' and coerce: parseCSV combo isn't enough to produce the string[] type for projects and groups
  handler: async () => {
    showHelp();
    process.exit(1);
  },
};

const versionCommand: CommandModule<NxReleaseArgs, VersionOptions> = {
  command: 'version [specifier]',
  aliases: ['v'],
  describe:
    'Create a version and release for one or more applications and libraries',
  builder: (yargs) =>
    withGitCommitAndGitTagOptions(
      yargs
        .positional('specifier', {
          type: 'string',
          describe:
            'Exact version or semver keyword to apply to the selected release group.',
        })
        .option('preid', {
          type: 'string',
          describe:
            'The optional prerelease identifier to apply to the version, in the case that specifier has been set to prerelease.',
          default: '',
        })
        .option('stageChanges', {
          type: 'boolean',
          describe:
            'Whether or not to stage the changes made by this command, irrespective of the git config in nx.json related to automated commits. Useful when combining this command with changelog generation.',
          default: false,
        })
    ),
  handler: (args) =>
    import('./version')
      .then((m) => m.releaseVersion(args))
      .then((versionDataOrExitCode) => {
        if (typeof versionDataOrExitCode === 'number') {
          return process.exit(versionDataOrExitCode);
        }
        process.exit(0);
      }),
};

const changelogCommand: CommandModule<NxReleaseArgs, ChangelogOptions> = {
  command: 'changelog [version]',
  aliases: ['c'],
  describe:
    'Generate a changelog for one or more projects, and optionally push to Github',
  builder: (yargs) =>
    withGitCommitAndGitTagOptions(
      yargs
        // Disable default meaning of yargs version for this command
        .version(false)
        .positional('version', {
          type: 'string',
          description:
            'The version to create a Github release and changelog for',
        })
        .option('from', {
          type: 'string',
          description:
            'The git reference to use as the start of the changelog. If not set it will attempt to resolve the latest tag and use that',
        })
        .option('to', {
          type: 'string',
          description: 'The git reference to use as the end of the changelog',
          default: 'HEAD',
        })
        .option('interactive', {
          alias: 'i',
          type: 'string',
          description:
            'Interactively modify changelog markdown contents in your code editor before applying the changes. You can set it to be interactive for all changelogs, or only the workspace level, or only the project level',
          choices: ['all', 'workspace', 'projects'],
        })
        .option('gitRemote', {
          type: 'string',
          description:
            'Alternate git remote in the form {user}/{repo} on which to create the Github release (useful for testing)',
          default: 'origin',
        })
        .check((argv) => {
          if (!argv.version) {
            throw new Error(
              'An explicit target version must be specified when using the changelog command directly'
            );
          }
          return true;
        })
    ),
  handler: async (args) => {
    const status = await (await import('./changelog')).releaseChangelog(args);
    process.exit(status);
  },
};

const publishCommand: CommandModule<NxReleaseArgs, PublishOptions> = {
  command: 'publish',
  aliases: ['p'],
  describe: 'Publish a versioned project to a registry',
  builder: (yargs) =>
    withRunManyOptions(withOutputStyleOption(yargs))
      .option('registry', {
        type: 'string',
        description: 'The registry to publish to',
      })
      .option('tag', {
        type: 'string',
        description: 'The distribution tag to apply to the published package',
      })
      .option('otp', {
        type: 'number',
        description:
          'A one-time password for publishing to a registry that requires 2FA',
      }),
  handler: (args) =>
    import('./publish').then((m) =>
      m.releasePublish(coerceParallelOption(withOverrides(args, 2)))
    ),
};

function coerceParallelOption(args: any) {
  if (args['parallel'] === 'false' || args['parallel'] === false) {
    return {
      ...args,
      parallel: 1,
    };
  } else if (
    args['parallel'] === 'true' ||
    args['parallel'] === true ||
    args['parallel'] === ''
  ) {
    return {
      ...args,
      parallel: Number(args['maxParallel'] || args['max-parallel'] || 3),
    };
  } else if (args['parallel'] !== undefined) {
    return {
      ...args,
      parallel: Number(args['parallel']),
    };
  }
  return args;
}

function withGitCommitAndGitTagOptions<T>(
  yargs: Argv<T>
): Argv<T & GitCommitAndTagOptions> {
  return yargs
    .option('git-commit', {
      describe:
        'Whether or not to automatically commit the changes made by this command',
      type: 'boolean',
    })
    .option('git-commit-message', {
      describe:
        'Custom git commit message to use when committing the changes made by this command. {version} will be dynamically interpolated when performing fixed releases, interpolated tags will be appended to the commit body when performing independent releases.',
      type: 'string',
    })
    .option('git-commit-args', {
      describe:
        'Additional arguments (added after the --message argument, which may or may not be customized with --git-commit-message) to pass to the `git commit` command invoked behind the scenes',
      type: 'string',
    })
    .option('git-tag', {
      describe:
        'Whether or not to automatically tag the changes made by this command',
      type: 'boolean',
    })
    .option('git-tag-message', {
      describe:
        'Custom git tag message to use when tagging the changes made by this command. This defaults to be the same value as the tag itself.',
      type: 'string',
    })
    .option('git-tag-args', {
      describe:
        'Additional arguments to pass to the `git tag` command invoked behind the scenes',
      type: 'string',
    });
}
