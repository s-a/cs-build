#!/usr/bin/env node

'use strict'

const Cli = require('n-cli')
const fs = require('fs')
const path = require('path')
const isGitClean = require('is-git-clean')
const branch = require('git-branch')
const shell = require('shelljs')
const ora = require('ora')

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
		const currentBranch = await branch(folder)
		if (currentBranch === 'master' || currentBranch === 'development') {
			throw new cli.Error('INVALID_REPOSITORY_BRANCH', `"${currentBranch}" in "${folder}"`)
		} else {
			spinner.succeed(`"${folder}" branch ${currentBranch}`)
		}
	} else {
		throw new cli.Error('INVALID_REPOSITORY_STATE', `"${folder}" repository is not clean\n`)
	}
}

const checkCommitsBehind = async repository => {
	spinner.start(`"${repository}" behind development?`)
	const gitFolder = path.join(repository, '.git')
	const executionResult = await shell.exec(`git --git-dir=${gitFolder} rev-list --left-right --count development...HEAD`, {
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

const validateRepositories = async (project, stage, settings) => {
	if (!fs.existsSync(settings.server)) {
		throw new cli.Error('INVALID_CONFIG', 'Repository for server not found. Use cs-build set --server /path/to/repository/\n')
	}

	if (!fs.existsSync(settings.client)) {
		throw new cli.Error('INVALID_CONFIG', 'Repository for cs client not found. Use cs-build set --client /path/to/repository/\n')
	}

	if (settings.client.toLowerCase() === settings.server.toLowerCase()) {
		throw new cli.Error('INVALID_CONFIG', 'Repository folders for client and server have to be different\n')
	}

	await validateRepositoryBranch(settings.client)
	await validateRepositoryBranch(settings.server)
	await checkCommitsBehind(settings.client)
	await checkCommitsBehind(settings.server)
	await execShellCommand(`npm test --prefix ${settings.client}`)
	await execShellCommand(`npm test --prefix ${settings.server}`)
	spinner.info('ready to build')
	spinner.stop()
	await execShellCommand(`npm run build-nightly --prefix ${settings.client}`, false)
}

cli.on('make', function () {
	const project = this.argv._[2]
	if (typeof project !== 'string') {
		throw new cli.Error('INVALID_ARGUMENTS', '`PROJECT-NAME` is not optional')
	}
	if (this.argv.project && this.argv.stage) {
		spinner.start('baking client and server...')
		const config = this.config.settings[this.argv.project]
		validateRepositories(this.argv.project, this.argv.stage, config)
		this.execResult = 0
	}
})

cli.on('config', function () {
	const project = this.argv._[2]
	if (typeof project !== 'string') {
		throw new cli.Error('INVALID_ARGUMENTS', '`PROJECT-NAME` is not optional')
	}

	if (typeof this.argv.server !== 'string' && typeof this.argv.client !== 'string') {
		throw new cli.Error('INVALID_ARGUMENTS', '`--client /path/to/client` or `--server /path/to/server` are not optional')
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
	this.execResult = 0
})

process.on('unhandledRejection', (error) => {
	spinner.stop()
	cli.renderError(error)
})

cli.runcom(function (rc) {
	if (this.execResult !== 0) {
		throw new cli.Error('INVALID_COMMAND', 'Invalid command. Type `cs-build help` to display valid arguments for this application.')
	}
})