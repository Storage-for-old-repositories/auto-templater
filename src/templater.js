/**
 * @typedef { import('./types').Dependency } Dependency
 * @typedef { import('./types').Service } Service
 * @typedef { import('./types').VariableRef } VariableRef
 * @typedef { import('./types').VariableConst } VariableConst
 * @typedef { import('./types').Resolver } ResolverCallback
 * @typedef { import('./types').ResolverArgs } ResolverArgs
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
   * @param { string } name
   * @param { VariableRef | VariableConst } variable
   */
  registVariable(name, variable) {
    this.variables.set(name, variable);
  }

  /**
   * @param { string } name
   * @param { string } providerName
   * @param { Dependency[] } dependencies
   */
  registService(name, providerName, dependencies) {
    this.services.set(name, {
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
        const [name, value] = assign.split("=").map((t) => t.trim());
        /** @type { Dependency } */
        const dependency = {
          name,
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
  registResolver(name, resolver, argsModel = {}) {
    this._resolvers.set(name, {
      callback: resolver,
      argsModel,
    });
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

    return queueResolving;
  }

  /**
   * @param { Map<string, Service> } services
   * @private
   */
  _validateAvailabilityServices(services) {
    for (const { name } of services.values()) {
      if (!this._resolvers.has(name)) {
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
    return queueResolving;
  }
}

module.exports = {
  Resolver,
  parser: Parser.parse,
};
