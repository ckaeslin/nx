import {
  ProjectGraphProjectNode,
  Tree,
  formatFiles,
  joinPathFragments,
  output,
  readJson,
  updateJson,
  workspaceRoot,
  writeJson,
} from '@nx/devkit';
import * as chalk from 'chalk';
import { exec } from 'child_process';
import { CATCH_ALL_RELEASE_GROUP } from 'nx/src/command-line/release/config/config';
import { getLatestGitTagForPattern } from 'nx/src/command-line/release/utils/git';
import {
  resolveSemverSpecifierFromConventionalCommits,
  resolveSemverSpecifierFromPrompt,
} from 'nx/src/command-line/release/utils/resolve-semver-specifier';
import { isValidSemverSpecifier } from 'nx/src/command-line/release/utils/semver';
import {
  VersionData,
  deriveNewSemverVersion,
} from 'nx/src/command-line/release/version';
import { interpolate } from 'nx/src/tasks-runner/utils';
import * as ora from 'ora';
import { relative } from 'path';
import { prerelease } from 'semver';
import { ReleaseVersionGeneratorSchema } from './schema';
import { resolveLocalPackageDependencies } from './utils/resolve-local-package-dependencies';

export async function releaseVersionGenerator(
  tree: Tree,
  options: ReleaseVersionGeneratorSchema
) {
  try {
    const versionData: VersionData = {};

    // If the user provided a specifier, validate that it is valid semver or a relative semver keyword
    if (options.specifier && !isValidSemverSpecifier(options.specifier)) {
      throw new Error(
        `The given version specifier "${options.specifier}" is not valid. You provide an exact version or a valid semver keyword such as "major", "minor", "patch", etc.`
      );
    }

    const projects = options.projects;

    const createResolvePackageRoot =
      (customPackageRoot?: string) =>
      (projectNode: ProjectGraphProjectNode): string => {
        // Default to the project root if no custom packageRoot
        if (!customPackageRoot) {
          return projectNode.data.root;
        }
        return interpolate(customPackageRoot, {
          workspaceRoot: '',
          projectRoot: projectNode.data.root,
          projectName: projectNode.name,
        });
      };

    const resolvePackageRoot = createResolvePackageRoot(options.packageRoot);

    // Resolve any custom package roots for each project upfront as they will need to be reused during dependency resolution
    const projectNameToPackageRootMap = new Map<string, string>();
    for (const project of projects) {
      projectNameToPackageRootMap.set(
        project.name,
        resolvePackageRoot(project)
      );
    }

    let currentVersion: string;

    // only used for options.currentVersionResolver === 'git-tag', but
    // must be declared here in order to reuse it for additional projects
    let latestMatchingGitTag: { tag: string; extractedVersion: string };

    // if specifier is undefined, then we haven't resolved it yet
    // if specifier is null, then it has been resolved and no changes are necessary
    let specifier = options.specifier ? options.specifier : undefined;

    for (const project of projects) {
      const projectName = project.name;
      const packageRoot = projectNameToPackageRootMap.get(projectName);
      const packageJsonPath = joinPathFragments(packageRoot, 'package.json');
      const workspaceRelativePackageJsonPath = relative(
        workspaceRoot,
        packageJsonPath
      );

      const color = getColor(projectName);
      const log = (msg: string) => {
        console.log(color.instance.bold(projectName) + ' ' + msg);
      };

      if (!tree.exists(packageJsonPath)) {
        throw new Error(
          `The project "${projectName}" does not have a package.json available at ${workspaceRelativePackageJsonPath}.

To fix this you will either need to add a package.json file at that location, or configure "release" within your nx.json to exclude "${projectName}" from the current release group, or amend the packageRoot configuration to point to where the package.json should be.`
        );
      }

      output.logSingleLine(
        `Running release version for project: ${color.instance.bold(
          project.name
        )}`
      );

      const projectPackageJson = readJson(tree, packageJsonPath);
      log(
        `🔍 Reading data for package "${projectPackageJson.name}" from ${workspaceRelativePackageJsonPath}`
      );

      const { name: packageName, version: currentVersionFromDisk } =
        projectPackageJson;

      switch (options.currentVersionResolver) {
        case 'registry': {
          const metadata = options.currentVersionResolverMetadata;
          const registry =
            metadata?.registry ??
            (await getNpmRegistry()) ??
            'https://registry.npmjs.org';
          const tag = metadata?.tag ?? 'latest';

          /**
           * If the currentVersionResolver is set to registry, and the projects are not independent, we only want to make the request once for the whole batch of projects.
           * For independent projects, we need to make a request for each project individually as they will most likely have different versions.
           */
          if (
            !currentVersion ||
            options.releaseGroup.projectsRelationship === 'independent'
          ) {
            const spinner = ora(
              `${Array.from(new Array(projectName.length + 3)).join(
                ' '
              )}Resolving the current version for tag "${tag}" on ${registry}`
            );
            spinner.color =
              color.spinnerColor as typeof colors[number]['spinnerColor'];
            spinner.start();

            // Must be non-blocking async to allow spinner to render
            currentVersion = await new Promise<string>((resolve, reject) => {
              exec(
                `npm view ${packageName} version --registry=${registry} --tag=${tag}`,
                (error, stdout, stderr) => {
                  if (error) {
                    return reject(error);
                  }
                  if (stderr) {
                    return reject(stderr);
                  }
                  return resolve(stdout.trim());
                }
              );
            });

            spinner.stop();

            log(
              `📄 Resolved the current version as ${currentVersion} for tag "${tag}" from registry ${registry}`
            );
          } else {
            log(
              `📄 Using the current version ${currentVersion} already resolved from the registry ${registry}`
            );
          }
          break;
        }
        case 'disk':
          currentVersion = currentVersionFromDisk;
          log(
            `📄 Resolved the current version as ${currentVersion} from ${packageJsonPath}`
          );
          break;
        case 'git-tag': {
          if (
            !currentVersion ||
            // We always need to independently resolve the current version from git tag per project if the projects are independent
            options.releaseGroup.projectsRelationship === 'independent'
          ) {
            const releaseTagPattern = options.releaseGroup.releaseTagPattern;
            latestMatchingGitTag = await getLatestGitTagForPattern(
              releaseTagPattern,
              {
                projectName: project.name,
              }
            );
            if (!latestMatchingGitTag) {
              throw new Error(
                `No git tags matching pattern "${releaseTagPattern}" for project "${project.name}" were found. You will need to create an initial matching tag to use as a base for determining the next version.`
              );
            }

            currentVersion = latestMatchingGitTag.extractedVersion;
            log(
              `📄 Resolved the current version as ${currentVersion} from git tag "${latestMatchingGitTag.tag}".`
            );
          } else {
            log(
              `📄 Using the current version ${currentVersion} already resolved from git tag "${latestMatchingGitTag.tag}".`
            );
          }
          break;
        }
        default:
          throw new Error(
            `Invalid value for options.currentVersionResolver: ${options.currentVersionResolver}`
          );
      }

      if (options.specifier) {
        log(`📄 Using the provided version specifier "${options.specifier}".`);
      }

      /**
       * If we are versioning independently then we always need to determine the specifier for each project individually, except
       * for the case where the user has provided an explicit specifier on the command.
       *
       * Otherwise, if versioning the projects together we only need to perform this logic if the specifier is still unset from
       * previous iterations of the loop.
       *
       * NOTE: In the case that we have previously determined via conventional commits that no changes are necessary, the specifier
       * will be explicitly set to `null`, so that is why we only check for `undefined` explicitly here.
       */
      if (
        specifier === undefined ||
        (options.releaseGroup.projectsRelationship === 'independent' &&
          !options.specifier)
      ) {
        const specifierSource = options.specifierSource;
        switch (specifierSource) {
          case 'conventional-commits':
            if (options.currentVersionResolver !== 'git-tag') {
              throw new Error(
                `Invalid currentVersionResolver "${options.currentVersionResolver}" provided for release group "${options.releaseGroup.name}". Must be "git-tag" when "specifierSource" is "conventional-commits"`
              );
            }

            specifier = await resolveSemverSpecifierFromConventionalCommits(
              latestMatchingGitTag.tag,
              options.projectGraph,
              projects.map((p) => p.name)
            );

            if (!specifier) {
              log(
                `🚫 No changes were detected using git history and the conventional commits standard.`
              );
              break;
            }

            // TODO: reevaluate this logic/workflow for independent projects
            //
            // Always assume that if the current version is a prerelease, then the next version should be a prerelease.
            // Users must manually graduate from a prerelease to a release by providing an explicit specifier.
            if (prerelease(currentVersion)) {
              specifier = 'prerelease';
              log(
                `📄 Resolved the specifier as "${specifier}" since the current version is a prerelease.`
              );
            } else {
              log(
                `📄 Resolved the specifier as "${specifier}" using git history and the conventional commits standard.`
              );
            }
            break;
          case 'prompt': {
            // Only add the release group name to the log if it is one set by the user, otherwise it is useless noise
            const maybeLogReleaseGroup = (log: string): string => {
              if (options.releaseGroup.name === CATCH_ALL_RELEASE_GROUP) {
                return log;
              }
              return `${log} within release group "${options.releaseGroup.name}"`;
            };
            if (options.releaseGroup.projectsRelationship === 'independent') {
              specifier = await resolveSemverSpecifierFromPrompt(
                `${maybeLogReleaseGroup(
                  `What kind of change is this for project "${projectName}"`
                )}?`,
                `${maybeLogReleaseGroup(
                  `What is the exact version for project "${projectName}"`
                )}?`
              );
            } else {
              specifier = await resolveSemverSpecifierFromPrompt(
                `${maybeLogReleaseGroup(
                  `What kind of change is this for the ${projects.length} matched projects(s)`
                )}?`,
                `${maybeLogReleaseGroup(
                  `What is the exact version for the ${projects.length} matched project(s)`
                )}?`
              );
            }
            break;
          }
          default:
            throw new Error(
              `Invalid specifierSource "${specifierSource}" provided. Must be one of "prompt" or "conventional-commits"`
            );
        }
      }

      // Resolve any local package dependencies for this project (before applying the new version or updating the versionData)
      const localPackageDependencies = resolveLocalPackageDependencies(
        tree,
        options.projectGraph,
        projects,
        projectNameToPackageRootMap,
        resolvePackageRoot,
        // includeAll when the release group is independent, as we may be filtering to a specific subset of projects, but we still want to update their dependents
        options.releaseGroup.projectsRelationship === 'independent'
      );

      const dependentProjects = Object.values(localPackageDependencies)
        .flat()
        .filter((localPackageDependency) => {
          return localPackageDependency.target === project.name;
        });

      versionData[projectName] = {
        currentVersion,
        dependentProjects,
        newVersion: null, // will stay as null in the final result the case that no changes are detected
      };

      if (!specifier) {
        log(
          `🚫 Skipping versioning "${projectPackageJson.name}" as no changes were detected.`
        );
        continue;
      }

      const newVersion = deriveNewSemverVersion(
        currentVersion,
        specifier,
        options.preid
      );
      versionData[projectName].newVersion = newVersion;

      writeJson(tree, packageJsonPath, {
        ...projectPackageJson,
        version: newVersion,
      });

      log(
        `✍️  New version ${newVersion} written to ${workspaceRelativePackageJsonPath}`
      );

      if (dependentProjects.length > 0) {
        log(
          `✍️  Applying new version ${newVersion} to ${
            dependentProjects.length
          } ${
            dependentProjects.length > 1
              ? 'packages which depend'
              : 'package which depends'
          } on ${project.name}`
        );
      }

      for (const dependentProject of dependentProjects) {
        updateJson(
          tree,
          joinPathFragments(
            projectNameToPackageRootMap.get(dependentProject.source),
            'package.json'
          ),
          (json) => {
            json[dependentProject.dependencyCollection][packageName] =
              newVersion;
            return json;
          }
        );
      }
    }

    /**
     * Ensure that formatting is applied so that version bump diffs are as mimimal as possible
     * within the context of the user's workspace.
     */
    await formatFiles(tree);

    // Return the version data so that it can be leveraged by the overall version command
    return versionData;
  } catch (e) {
    if (process.env.NX_VERBOSE_LOGGING === 'true') {
      output.error({
        title: e.message,
      });
      // Dump the full stack trace in verbose mode
      console.error(e);
    } else {
      output.error({
        title: e.message,
      });
    }
    process.exit(1);
  }
}

export default releaseVersionGenerator;

const colors = [
  { instance: chalk.green, spinnerColor: 'green' },
  { instance: chalk.greenBright, spinnerColor: 'green' },
  { instance: chalk.red, spinnerColor: 'red' },
  { instance: chalk.redBright, spinnerColor: 'red' },
  { instance: chalk.cyan, spinnerColor: 'cyan' },
  { instance: chalk.cyanBright, spinnerColor: 'cyan' },
  { instance: chalk.yellow, spinnerColor: 'yellow' },
  { instance: chalk.yellowBright, spinnerColor: 'yellow' },
  { instance: chalk.magenta, spinnerColor: 'magenta' },
  { instance: chalk.magentaBright, spinnerColor: 'magenta' },
] as const;

function getColor(projectName: string) {
  let code = 0;
  for (let i = 0; i < projectName.length; ++i) {
    code += projectName.charCodeAt(i);
  }
  const colorIndex = code % colors.length;

  return colors[colorIndex];
}

async function getNpmRegistry() {
  // Must be non-blocking async to allow spinner to render
  return await new Promise<string>((resolve, reject) => {
    exec('npm config get registry', (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }
      if (stderr) {
        return reject(stderr);
      }
      return resolve(stdout.trim());
    });
  });
}
