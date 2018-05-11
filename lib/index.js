#!/usr/bin/env node

'use strict'

const Cli = require('n-cli')
const fs = require('fs')
const path = require('path')
const isGitClean = require('is-git-clean')
const branch = require('git-branch')
const shell = require('shelljs')
const ora = require('ora')

Cli.prototype.argAtIndex = function (index, name) {
	const result = this.argv._[index]
	if (typeof result !== 'string') {
		throw new cli.Error('INVALID_ARGUMENT', `Missing argument "${name}". Type "cs-build help" to display valid arguments for this application.`)
	}
	return result
}

const spinner = ora({
	spinner: 'simpleDots'
})

const cli = new Cli({
	silent: false,
	handleUncaughtException: true, // beautifies error output to console
	handledRejectionPromiseError: false, // beautifyies error output to console
	runcom: '.myapprc'
})

const validateRepositoryBranch = async folder => {
	spinner.start(`"${folder}" branch master or development?`)
	const clean = await isGitClean(folder)
	if (clean) {
		const pkg = require(path.join(folder, 'package.json'))
		if (!pkg.csBuild) {
			pkg.csBuild = {}
		}
		const protectedBranches = pkg.csBuild.protectedBranches || ['production', 'development']
		const currentBranch = await branch(folder)
		if (protectedBranches.indexOf(currentBranch) === -1) {
			spinner.succeed(`"${folder}" branch ${currentBranch}`)
		} else {
			throw new cli.Error('INVALID_REPOSITORY_BRANCH', `"${currentBranch}" in "${folder}"`)
		}
	} else {
		throw new cli.Error('INVALID_REPOSITORY_STATE', `"${folder}" repository is not clean\n`)
	}
}

const checkCommitsBehind = async (repository, stage) => {
	spinner.start(`"${repository}" behind ${stage}?`)
	const gitFolder = path.join(repository, '.git')
	const executionResult = await shell.exec(`git --git-dir=${gitFolder} rev-list --left-right --count ${stage}...HEAD`, {
		silent: true
	})
	if (executionResult.code === 0) {
		const s = executionResult.stdout.replace(/\n/g, '').split('\t')
		const behind = parseInt(s[0], 10)
		const ahead = parseInt(s[1], 10)
		if (behind === 0) {
			spinner.succeed(`"${repository}" commits not behind development`)
		} else {
			throw new cli.Error('COMMITS_BEHIND', `repository is behind ${behind} and ahead ${ahead} commits\n`)
		}
	} else {
		throw new cli.Error('GIT_ERROR', executionResult.stderr)
	}
}

const execShellCommand = async (cmd, silent) => {
	spinner.start(cmd)
	const executionResult = await shell.exec(cmd, {
		silent: (silent === undefined ? true : silent)
	})
	if (executionResult.code === 0) {
		spinner.succeed(cmd)
		return true
	} else {
		throw new cli.Error('SHELL_COMMAND_FAIL', cmd)
	}
}

const validateRepositories = async (config) => {
	if (!fs.existsSync(config.settings.server)) {
		throw new cli.Error('INVALID_CONFIG', `Repository ${config.settings.server} for server not found. Use cs-build config [PROJECT-NAME] --server /path/to/repository/\n`)
	}

	if (!fs.existsSync(config.settings.client)) {
		throw new cli.Error('INVALID_CONFIG', `Repository ${config.settings.server} for cs client not found. Use cs-build config [PROJECT-NAME] --client /path/to/repository/\n`)
	}

	if (config.settings.client.toLowerCase() === config.settings.server.toLowerCase()) {
		throw new cli.Error('INVALID_CONFIG', 'Repository folders for client and server have to be different\n')
	}

	await execShellCommand(`git --git-dir=${path.join(config.settings.client, '.git')} fetch --all`)
	await execShellCommand(`git --git-dir=${path.join(config.settings.server, '.git')} fetch --all`)
	await validateRepositoryBranch(config.settings.client)
	await validateRepositoryBranch(config.settings.server)
	await checkCommitsBehind(config.settings.client, config.stage)
	await checkCommitsBehind(config.settings.server, config.stage)
	await execShellCommand(`npm test --prefix ${config.settings.client}`)
	await execShellCommand(`npm test --prefix ${config.settings.server}`)
	spinner.info(`npm test --prefix ${config.project}`)
	spinner.stop()
	await execShellCommand(`npm run build-nightly --prefix ${config.settings.client}`, false)
}

cli.on('config', function () {
	if (this.argv._.length === 1) {
		this.log(this.config)
	} else {
		const project = this.argAtIndex(1, '[PROJECT]')

		if (typeof this.argv.server !== 'string' && typeof this.argv.client !== 'string') {
			throw new cli.Error('INVALID_ARGUMENTS', 'use `--client /path/to/client` and/or `--server /path/to/server`.')
		}

		if (!this.config.settings[project]) {
			this.config.settings[project] = {}
		}

		if (this.argv.server) {
			this.config.settings[project].server = this.argv.server
			this.config.save()
		}

		if (this.argv.client) {
			this.config.settings[project].client = this.argv.client
			this.config.save()
		}

		this.stdout(cli.color.green(`${project} settings written.`))
	}
	this.execResult = 0
})

process.on('unhandledRejection', (error) => {
	spinner.stop()
	cli.renderError(error)
})

cli.runcom(function (rc) {
	if (this.execResult !== 0) {
		const project = this.argAtIndex(0, '[PROJECT]')
		const stage = this.argAtIndex(1, '[STAGE]')
		const config = this.config.settings[project]

		if (!config) {
			throw new cli.Error('INVALID_CONFIG', `Missing configuration for "${project}". Use "cs-build config [PROJECT-NAME]" to projects and stages.`)
		}
		spinner.start(`build ${project}/${stage}`)

		validateRepositories({
			project,
			stage,
			settings: config
		})
		// throw new cli.Error('INVALID_COMMAND', 'Invalid command. Type `cs-build help` to display valid arguments for this application.')
	}
})