/**
 * @typedef { import('./types').Dependency } Dependency
 * @typedef { import('./types').Service } Service
 * @typedef { import('./types').VariableRef } VariableRef
 * @typedef { import('./types').VariableConst } VariableConst
 * @typedef { import('./types').Resolver } ResolverCallback
 * @typedef { import('./types').ResolverArgs } ResolverArgs
 * @typedef { import('./types').ResolverAvailableTypes } ResolverAvailableTypes
 */

class TemplaterError extends Error {}

const TAG_DATA = "#data";
const TAG_VIEW = "#view";

const SERVICE_VARIABLE = "$";
const SERVICE_CHAR = "@";

const REGEXP_LINE_COMMENT = /^[ \t]*\/\//;
const REGEXP_LINE_EMPTY = /^[ \t]*$/;
const REGEXP_NEW_LINE = /\r?\n/;
const REGEXP_STRING_LITERAL = /^'.+'$/;
const REGEXP_LINE_CARRY = /\\\s+$/;

const REGEXP_HEAD_DATA = /^#data\s*$/;
const REGEXP_HEAD_VIEW = /^#view(\(([a-z_]+)\))?\s*$/;

const REGEXP_IDENTIFIER = /^[@$][a-z][a-z_]*$/;
const REGEXP_INTERNAL_IDENTIFIER = /^[@$]internal_/;

const REGEXP_VARIABLE = /^([a-z][a-z_]*) *<- *(@[a-z][a-z_]*)*$/;
const REGEXP_SERVICE =
  /^([A-Z][a-zA-Z]+) *({ *([a-z][a-z_]* *= *\$[a-z][a-z_]*; *)+ *})?$/;

class ResolverContext {
  constructor() {
    /** @type { Map<string, VariableRef | VariableConst> } */
    this.variables = new Map();
    /** @type { Map<string, Service> } */
    this.services = new Map();
  }

  /**
   * @param { string } key
   * @param { VariableRef | VariableConst } variable
   */
  registVariable(key, variable) {
    this.variables.set(key, variable);
  }

  /**
   * @param { string } key
   * @param { string } providerName
   * @param { Dependency[] } dependencies
   */
  registService(key, providerName, dependencies) {
    this.services.set(key, {
      key,
      name: providerName,
      dependencies,
    });
  }
}

class Parser {
  /**
   * @param { string } text
   * @private
   */
  constructor(text) {
    this._text = text;
    this._resolverContext = new ResolverContext();
  }

  /**
   * @param { string } text
   */
  static parse(text) {
    const parser = new Parser(text);
    return parser.parse();
  }

  parse() {
    const { data, view } = this.splitRegions();
    const { version, lines } = this.parseViewRegion(view);

    this.parseDataRegion(data);
    return {
      viewVersion: version,
      viewLines: lines,
      resolverContext: this._resolverContext,
    };
  }

  splitRegions() {
    const lines = this._text.split(REGEXP_NEW_LINE);

    const regionDataIndex = this.findIndexTag(lines, TAG_DATA);
    const regionViewIndex = this.findIndexTag(lines, TAG_VIEW);

    if (regionDataIndex > regionViewIndex) {
      throw new TemplaterError("region @view must be after region @data");
    }

    const data = lines.slice(regionDataIndex, regionViewIndex);
    const view = lines.slice(regionViewIndex);
    return { data, view };
  }

  /**
   * @param { string[] } lines
   * @param { string } tag
   */
  findIndexTag(lines, tag) {
    const index = lines.findIndex((text) => text.startsWith(tag));
    if (!index) {
      throw new TemplaterError(`required region @${tag} not found`);
    }

    const maybeDuplicateRegion = lines
      .slice(index + 1)
      .find((text) => text.startsWith(tag));
    if (maybeDuplicateRegion) {
      throw new TemplaterError(`region @${tag} announced several times`);
    }
    return index;
  }

  /**
   * @param { string[] } texts
   */
  parseDataRegion(texts) {
    const [head, ...lines] = texts;
    this.validateDataHead(head);

    /** @type { string[] } */
    const preparedLines = [];
    let lineBuild = "";
    for (const line of lines) {
      if (REGEXP_LINE_COMMENT.test(line) || REGEXP_LINE_EMPTY.test(line)) {
        continue;
      }

      lineBuild += line.trim();

      if (!REGEXP_LINE_CARRY.test(line)) {
        preparedLines.push(lineBuild);
        lineBuild = "";
        continue;
      }

      lineBuild = lineBuild.replace(REGEXP_LINE_CARRY, "");
    }

    if (lineBuild != "") {
      preparedLines.push(lineBuild);
    }

    for (const line of preparedLines) {
      this.parseDataLine(line.trim());
    }
  }

  /** @param { string } head */
  validateDataHead(head) {
    if (!REGEXP_HEAD_DATA.test(head)) {
      throw new TemplaterError(
        `after the heading @data there should be no non-whitespace characters - "${head}"`
      );
    }
  }

  /** @param { string } line */
  parseDataLine(line) {
    const [key, ...assigns] = line.split("=");
    const id = key.trim();
    const assign = assigns.join("=").trim();

    if (!REGEXP_IDENTIFIER.test(id)) {
      throw new TemplaterError(`invalid variable name "${id}"`);
    }

    if (REGEXP_INTERNAL_IDENTIFIER.test(id)) {
      throw new TemplaterError(
        `prefix "internal_" is not publicly available - "${id}"`
      );
    }

    const name = id.slice(1);
    if (id.startsWith(SERVICE_CHAR)) {
      this.parseDataSeviceLine(name, assign);
    } else {
      this.parseDataVariableLine(name, assign);
    }
  }

  /**
   * @param { string } name
   * @param { string } line
   */
  parseDataSeviceLine(name, line) {
    const maths = REGEXP_SERVICE.exec(line);
    if (maths) {
      const [, providerName, args] = maths;
      const dependencies =
        typeof args === "string" ? this.parseDataServiceDependencies(args) : [];
      return this.registService({
        name,
        providerName,
        dependencies,
      });
    }
  }

  /**
   * @param { string } text
   */
  parseDataServiceDependencies(text) {
    return text
      .slice(1, -1)
      .split(";")
      .slice(0, -1) /** ["a = b", "c = d", ""] -> ["a = b", "c = d"] */
      .map((assign) => {
        const [key, value] = assign.split("=").map((t) => t.trim());
        /** @type { Dependency } */
        const dependency = {
          key: key,
          name: key,
          variableName: value.slice(1),
        };
        return dependency;
      });
  }

  /**
   * @param { object } props
   * @param { string } props.name
   * @param { string } props.providerName
   * @param { Dependency[] } props.dependencies
   * @private
   */
  registService({ name, providerName, dependencies }) {
    this._resolverContext.registService(name, providerName, dependencies);
  }

  /**
   * @param { string } name
   * @param { string } line
   */
  parseDataVariableLine(name, line) {
    if (REGEXP_STRING_LITERAL.test(line)) {
      return this.registVariable(name, {
        type: "const",
        constant: line.slice(1, -1),
      });
    }
    const match = REGEXP_VARIABLE.exec(line);
    if (match) {
      const [, key, service] = match;
      return this.registVariable(name, {
        type: "ref",
        fieldKey: key,
        service: service.slice(1),
      });
    }
    throw new TemplaterError(`invalid variable name "${line}"`);
  }

  /**
   * @param { string } name
   * @param { VariableRef | VariableConst } variable
   */
  registVariable(name, variable) {
    this._resolverContext.registVariable(name, variable);
  }

  /**
   * @param { string[] } texts
   */
  parseViewRegion(texts) {
    const [head, ...lines] = texts;
    const match = REGEXP_HEAD_VIEW.exec(head);
    if (match) {
      const version = match[2];
      return { version, lines };
    }
    throw new TemplaterError(`incorrect title for @view region - "${head}"`);
  }
}

/**
 * @typedef { Record<string, ResolverAvailableTypes> } Arguments
 *
 * @typedef Context
 * @type { object }
 * @property { Arguments } [args=undefined]
 */

/**
 * @param { Context } [context=undefined]
 */

class ResolverExecutor {
  /**
   * @typedef QueueResolving
   * @type { object }
   * @property { Service[] } queue
   * @property { Record<keyof Service, Service[]> } queueGrouped
   */

  /**
   * @param { object } props
   * @param { Map<string, ResolverValue> } props.resolvers
   * @param { ResolverContext } props.context
   * @param { Record<string, ResolverAvailableTypes> } props.variableBase
   * @param { Map<string, Record<string, string>> } props.serviceModels
   * @param { QueueResolving[] } props.queueResolving
   */
  constructor({
    resolvers,
    context,
    variableBase,
    serviceModels,
    queueResolving,
  }) {
    this._resolvers = resolvers;
    this._context = context;
    this._variableBase = variableBase;
    this._serviceModels = serviceModels;
    this._queueResolving = queueResolving;
  }

  /**
   * @param { Context } [context=undefined]
   */
  async execute(context = {}) {
    const { args = {} } = context || {};

    /** @type { Record<string, ResolverAvailableTypes> } */
    const variable = {
      ...this._variableBase,
      ...args,
    };

    if (this._queueResolving.length > 0) {
      let currentQueue = new Set(this._queueResolving[0].queue);
      for (const { queue, queueGrouped } of this._queueResolving.slice(1)) {
        const nextQueue = new Set(queue);
        /** @type { Promise<void>[] } */
        const queuePromises = [];
        for (const serviceName of Object.keys(queueGrouped)) {
          /** @type { Service[] } */
          // @ts-ignore
          const services = queueGrouped[serviceName];
          /** @type { ResolverValue } */
          // @ts-ignore
          const resolver = this._resolvers.get(serviceName);
          queuePromises.push(this._resolve({ resolver, services, variable }));
        }

        await Promise.all(queuePromises);

        if (nextQueue.size === 0) {
          break;
        }
        currentQueue = nextQueue;
      }
    }

    console.log(variable);
  }

  /**
   * @param { object } props
   * @param { ResolverValue } props.resolver
   * @param { Service[] } props.services
   * @param { Record<string, ResolverAvailableTypes> } props.variable
   * @private
   */
  async _resolve({ resolver, services, variable }) {
    const { callback, argsModel } = resolver;
    try {
      const result = await callback(
        services.map((context) => {
          /** @type { ResolverArgs } */
          const args = {};
          for (const dependency of context.dependencies) {
            args[dependency.name] = variable[dependency.variableName];
          }
          return args;
        })
      );
      for (let i = 0; i < services.length; ++i) {
        const record = result[i];
        /** @type { Record<string, string> } */
        // @ts-ignore
        const model = this._serviceModels.get(services[i].key);
        for (const from of Object.keys(model)) {
          const to = model[from];
          variable[to] = record[from];
        }
      }
    } catch (error) {
      console.log(error);
    }
  }
}

class Resolver {
  /**
   * @typedef { Record<string, ('string' | 'string[]')[]> } ArgsModel
   *
   * @typedef ResolverValue
   * @type { object }
   * @property { ArgsModel } argsModel
   * @property { ResolverCallback } callback
   */

  constructor() {
    /** @type { Map<string, ResolverValue> } */
    this._resolvers = new Map();
  }

  /**
   * @param { string } name
   * @param { ResolverCallback } resolver
   * @param { ArgsModel } [argsModel={}]
   */
  registService(name, resolver, argsModel = {}) {
    this._validateSystemResolver(name);
    this._resolvers.set(name, {
      callback: resolver,
      argsModel,
    });
  }

  /**
   * @param { string } name
   * @private
   */
  _isSystemResolverName(name) {
    return name === "Arguments";
  }

  /**
   * @param { string } name
   * @private
   */
  _validateSystemResolver(name) {
    if (this._isSystemResolverName(name)) {
      throw new TemplaterError(
        `service "${name}" system and cannot be registered`
      );
    }
  }

  /** @param { ResolverContext } context */
  buildResolver(context) {
    this._validateAvailabilityServices(context.services);
    this._validateServiceProvideNames(context.services);

    const rootServices = this._calculateRootServices(context);
    const childrenServices = this._calculateChildrenServices(context);
    const queueResolving = this._calculateQueueResolving({
      rootServices,
      childrenServices,
    });

    const queueResolvingGrouped = queueResolving.map((queue) => {
      const queueGrouped = groupByField(queue, "name");
      return {
        queue,
        queueGrouped,
      };
    });

    /** @type { Record<string, ResolverAvailableTypes> } */
    const variableBase = {};
    /** @type { Map<string, Record<string, string>> } */
    const serviceModels = new Map();
    for (const [key, variable] of context.variables.entries()) {
      if (variable.type === "ref") {
        /** @type { Record<string, string> } */
        const model = serviceModels.get(variable.service) || {};
        serviceModels.set(variable.service, model);
        model[variable.fieldKey] = key;
      } else {
        variableBase[key] = variable.constant;
      }
    }

    const executor = new ResolverExecutor({
      context,
      variableBase,
      serviceModels,
      resolvers: this._resolvers,
      queueResolving: queueResolvingGrouped,
    });

    /**
     * @param { Context } [context=undefined]
     */
    const resolver = (context) => {
      return executor.execute(context);
    };
    return resolver;
  }

  /**
   * @param { Map<string, Service> } services
   * @private
   */
  _validateAvailabilityServices(services) {
    for (const { name } of services.values()) {
      if (!this._resolvers.has(name) && !this._isSystemResolverName(name)) {
        throw new TemplaterError(`service "${name}" has no implementation`);
      }
    }
  }

  /**
   * @param { Map<string, Service> } services
   * @private
   */
  _validateServiceProvideNames(services) {
    /** @type { Set<string> } */
    const set = new Set();
    for (const { name: key, dependencies } of services.values()) {
      for (const { name: arg } of dependencies) {
        const uuid = `${key}.${arg}`;
        set.add(uuid);
      }
    }
    for (const [key, { argsModel }] of this._resolvers.entries()) {
      for (const arg of Object.keys(argsModel)) {
        const uuid = `${key}.${arg}`;
        if (!set.has(uuid)) {
          throw new TemplaterError(
            `unknown argument "${arg}" in service "${key}"`
          );
        }
        set.add(`${key}.${arg}`);
      }
    }
  }

  /**
   * @param { ResolverContext } context
   * @private
   */
  _calculateRootServices({ services, variables }) {
    /** @type { Map<string, Service> } */
    const rootServices = new Map();
    for (const [key, service] of services.entries()) {
      let dependenciesCount = 0;
      for (const { variableName } of service.dependencies) {
        const isReferenceDependency =
          variables.get(variableName)?.type === "ref";
        if (isReferenceDependency) {
          ++dependenciesCount;
        }
      }
      if (dependenciesCount === 0) {
        rootServices.set(key, service);
      }
    }
    return rootServices;
  }

  /**
   * @param { ResolverContext } context
   * @private
   */
  _calculateChildrenServices({ services, variables }) {
    /** @type { Map<string, Map<string, Service>> } */
    const childrenServices = new Map();
    for (const [, childVariable] of variables.entries()) {
      if (childVariable.type === "const") {
        continue;
      }
      const childServiceName = childVariable.service;
      /** @type { Service } */
      // @ts-ignore
      const childService = services.get(childServiceName);
      for (const { variableName } of childService.dependencies) {
        const parentVariable = variables.get(variableName);
        if (parentVariable?.type === "ref") {
          const parentServiceName = parentVariable.service;
          const parentMap =
            childrenServices.get(parentServiceName) || new Map();
          const childMap = childrenServices.get(childServiceName) || new Map();
          childrenServices.set(
            parentServiceName,
            parentMap.set(childServiceName, childService)
          );
          childrenServices.set(childServiceName, childMap);
        }
      }
    }
    return childrenServices;
  }

  /**
   * @param { object } props
   * @param { Map<string, Map<string, Service>> } props.childrenServices
   * @param { Map<string, Service> } props.rootServices
   * @private
   */
  _calculateQueueResolving({ childrenServices, rootServices }) {
    /** @type { Service[][] } */
    const queueResolving = [];
    for (let services = rootServices; services.size > 0; ) {
      const queue = [...services.values()];
      queueResolving.push(queue);

      /** @type { Map<string, Service> } */
      const nextServices = new Map();

      for (const serviceName of services.keys()) {
        const childs = childrenServices.get(serviceName);
        if (!childs) {
          continue;
        }

        for (const [key, service] of childs.entries()) {
          nextServices.set(key, service);
        }
      }
      services = nextServices;
    }
    return this._filterSystemResolver(queueResolving);
  }

  /**
   * @param { Service[][] } services
   * @private
   */
  _filterSystemResolver(services) {
    return services
      .map((queue) => {
        return queue.filter(({ name }) => !this._isSystemResolverName(name));
      })
      .filter((queue) => {
        return queue.length > 0;
      });
  }
}

/**
 * @template { Record<string | number, any> } T
 * @param { T[] } arr
 * @param { keyof T } field
 */
function groupByField(arr, field) {
  /** @type { Record<keyof T, T[]>} */
  // @ts-ignore
  const result = {};
  for (const item of arr) {
    if (item[field] in result) {
      result[item[field]].push(item);
    } else {
      result[item[field]] = [item];
    }
  }
  return result;
}

module.exports = {
  Resolver,
  parser: Parser.parse,
};
